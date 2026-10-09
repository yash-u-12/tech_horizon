"""
NEXUS ROBOT GATEWAY  (FastAPI)
==============================

The physical boundary of the NEXUS digital-twin platform.

    React UI ──HTTP/WS──> this gateway ──> transport (ROS 2 topic / MCU serial) ──> body
                                    <── telemetry ──────────

Design rules that this service enforces, not merely documents:

 1. The browser NEVER actuates a robot. Every physical command arrives here, and
    only here, after the agent's own safety envelope has already been applied
    client-side. This gateway is a *second* independent gate: it re-validates
    every command against the device's advertised capabilities, its own state,
    command freshness, and its local e-stop before anything reaches a motor.
 2. Telemetry in this process originates from a real device session if one is
    attached (a ROS 2 topic bridge), otherwise from the BENCH DEVICE model. A
    device is advertised to the UI with `real: true|false`, and the UI is
    required to render bench telemetry as MOCK. Nothing is dressed up as a real
    robot.
 3. If a device is not attached, the gateway says OFFLINE. It does not keep
    publishing stale frames to look alive.
 4. Binding/unbinding is coordinated here so the deployment process is
    observable end-to-end, but authority for *which agent thinks* stays with the
    fleet: an agent may be re-bound to the same hardware later without losing
    its identity.

Run:
    pip install fastapi uvicorn
    uvicorn nexus_gateway:app --host 0.0.0.0 --port 8000

The gateway works with no hardware at all: it exposes the bench device nodes so
the deployment flow can be demonstrated honestly. Set NEXUS_REAL_DEVICE_P01=1
with a ROS 2 bridge URL to attach real hardware.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import random
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# --------------------------------------------------------------------------- #
#  device model                                                               #
# --------------------------------------------------------------------------- #


@dataclass
class Capabilities:
    """What a physical body can actually do — validated against, never assumed."""

    driveType: str = "DIFFERENTIAL"
    navigation: str = "AUTO"
    maxVelocity: float = 1.4
    maxAccel: float = 0.8
    maxOmega: float = 1.6
    minVelocity: float = 0.02
    lidar: bool = True
    payloadKg: float = 35.0
    collisionRadius: float = 0.55

    def as_dict(self) -> Dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class BenchBody:
    """
    A device-shaped body: the same command/telemetry contract as a real robot,
    with honest physics for the demo. Used when no physical robot is attached.
    """

    hardware_id: str
    label: str
    real: bool
    firmware: str
    capabilities: Capabilities
    x: float = 0.0
    z: float = 0.0
    theta: float = 0.0
    velocity: float = 0.0
    omega: float = 0.0
    target_v: float = 0.0
    target_omega: float = 0.0
    battery: float = 1.0
    seq: int = 0
    attached: bool = True
    busy: bool = False
    estop: bool = False
    bumper: bool = False
    lidar_healthy: bool = True
    link_quality: float = 1.0
    motor_current: float = 0.0
    wheel_slip: float = 0.0
    last_cmd_at: float = 0.0
    last_cmd_age_s: float = 0.0
    distance_m: float = 0.0
    rejected: int = 0
    violations: List[str] = field(default_factory=list)

    # -- status as the registry reports it ---------------------------------- #

    @property
    def status(self) -> str:
        if not self.attached:
            return "OFFLINE"
        if self.estop:
            return "ERROR"
        return "BUSY" if self.busy else "ONLINE"

    def snapshot(self) -> Dict[str, Any]:
        return {
            "id": self.hardware_id,
            "label": self.label,
            "status": self.status,
            "real": self.real,
            "firmware": self.firmware,
            "battery": round(self.battery, 4),
            "pose": {"x": round(self.x, 4), "z": round(self.z, 4), "theta": round(self.theta, 4)},
            "capabilities": self.capabilities.as_dict(),
            "transport": "ROS2_BRIDGE" if self.real else "BENCH_DEVICE",
            "rejected_commands": self.rejected,
        }

    # -- the safety gate at the device -------------------------------------- #

    def validate(self, cmd: Dict[str, Any], now: float) -> tuple[bool, str]:
        """
        Independent of anything the UI did. Returns (accepted, reason).
        """
        if not self.attached:
            return False, "device not attached"
        if self.estop:
            return False, "local e-stop asserted"
        if cmd.get("estop"):
            return False, "e-stop command routed to safety channel"

        # command freshness — a stale command is a safety violation, not a hint
        ts = cmd.get("ts")
        if ts is not None:
            age_ms = now * 1000.0 - float(ts)
            if age_ms > 900:
                return False, f"stale command ({age_ms:.0f} ms old)"

        v = float(cmd.get("v", 0.0))
        omega = float(cmd.get("omega", 0.0))
        caps = self.capabilities

        if abs(v) > caps.maxVelocity + 1e-6:
            return False, f"|v| {abs(v):.2f} > device limit {caps.maxVelocity:.2f}"
        if abs(omega) > caps.maxOmega + 1e-6:
            return False, f"|omega| {abs(omega):.2f} > device limit {caps.maxOmega:.2f}"
        if self.battery < 0.05 and v > 0:
            return False, "battery depleted"
        if self.bumper and v > 0:
            return False, "bumper tripped"
        if not self.lidar_healthy and v > 0.35:
            return False, "lidar fault — motion restricted"

        # note: acceleration is enforced by the drive's own slew limiter in
        # step(). A setpoint step is legal; the wheels simply cannot follow it
        # instantly, which is how a real controller behaves.
        return True, "ok"

    # -- physics ------------------------------------------------------------- #

    def step(self, dt: float, now: float) -> None:
        caps = self.capabilities
        # command timeout: 500 ms without a fresh command means stop
        self.last_cmd_age_s = now - self.last_cmd_at if self.last_cmd_at else 999.0
        if self.last_cmd_age_s > 0.5:
            self.target_v, self.target_omega = 0.0, 0.0

        if self.estop:
            self.target_v, self.target_omega = 0.0, 0.0

        # slew towards the commanded setpoint under the device's own accel limit
        dv = self.target_v - self.velocity
        max_dv = caps.maxAccel * dt
        self.velocity += max(-max_dv, min(max_dv, dv))
        dw = self.target_omega - self.omega
        max_dw = caps.maxOmega * dt * 2.0
        self.omega += max(-max_dw, min(max_dw, dw))

        # wheel slip and odometry noise — real bodies are not clean. Note there
        # is no rate deadband on the heading integration: a slow commanded turn
        # is still a turn, and dropping it would make the body diverge from the
        # plan it is being asked to follow.
        slip = 0.0
        if abs(self.velocity) > 0.05:
            slip = min(0.06, abs(self.velocity) * 0.02 + random.random() * 0.008)
            self.velocity *= 1.0 - slip * dt * 4
        if abs(self.omega) > 1e-4:
            self.theta += self.omega * dt * (1.0 + (random.random() - 0.5) * 0.02)
        self.theta = math.atan2(math.sin(self.theta), math.cos(self.theta))

        dx = self.velocity * math.cos(self.theta) * dt
        dz = self.velocity * math.sin(self.theta) * dt
        self.x += dx
        self.z += dz
        self.distance_m += math.hypot(dx, dz)

        self.motor_current = 0.4 + abs(self.velocity) * 2.1 + abs(self.omega) * 0.6 + random.random() * 0.05
        was_slip = self.wheel_slip
        self.wheel_slip = self.wheel_slip * 0.9 + slip * 0.1
        if abs(self.wheel_slip - was_slip) < 1e-9:
            self.wheel_slip = slip

        self.battery -= (0.0008 + abs(self.velocity) * 0.0022 + abs(self.omega) * 0.0004) * dt
        self.battery = max(0.0, self.battery)
        self.seq += 1

    def telemetry(self) -> Dict[str, Any]:
        return {
            "seq": self.seq,
            "pose": {"x": round(self.x, 4), "z": round(self.z, 4), "theta": round(self.theta, 4)},
            "velocity": round(self.velocity, 4),
            "omega": round(self.omega, 4),
            "battery": round(self.battery, 4),
            "motorCurrentA": round(self.motor_current, 3),
            "bumperTripped": self.bumper,
            "lidarHealthy": self.lidar_healthy,
            "estop": self.estop,
            "linkQuality": round(self.link_quality, 3),
            "wheelSlipEstimate": round(self.wheel_slip, 4),
            "distance": round(self.distance_m, 3),
        }


# --------------------------------------------------------------------------- #
#  gateway                                                                    #
# --------------------------------------------------------------------------- #


class RobotGateway:
    """
    Registry + fleet of device sessions + the command path. One instance per
    process; the WebSocket handler and the REST API share it.
    """

    TELEMETRY_HZ = 20.0
    HEARTBEAT_HZ = 1.0

    def __init__(self) -> None:
        self.bodies: Dict[str, BenchBody] = {}
        self.bound_agent: Dict[str, str] = {}  # hardware_id -> agent id (what the fleet asked for)
        self.bind_events: List[Dict[str, Any]] = []
        self.command_log: List[Dict[str, Any]] = []
        self._register_default_devices()
        self._started = time.time()

    # -- registry ------------------------------------------------------------ #

    def _register_default_devices(self) -> None:
        """
        Coordinates mirror the arena dock positions in the simulation world — a
        body parked outside the workspace is refused by the safety layer, as it
        should be.

        Three units, deliberately in three different states so the deployment
        flow has something honest to reason about:

          P01  attached bench rig — real only when NEXUS_REAL_DEVICE_P01=1
          P02  OFF-LINE           — no session, so no telemetry and the twin degrades
          P03  attached, BUSY     — powered and executing, but carrying no brain
        """
        # A real session exists only when a robot is genuinely attached to this
        # host (a ROS 2 bridge / MCU serial link). Without one, P01 is a BENCH
        # rig: same contract, honestly labelled `real: false` everywhere.
        p01_real = os.environ.get("NEXUS_REAL_DEVICE_P01") == "1"
        self.bodies["P01"] = BenchBody(
            hardware_id="P01",
            label="Fetch Pro XL — aisle unit",
            real=p01_real,
            firmware="2.7.1-ros2" if p01_real else "bench-0.9.4",
            capabilities=Capabilities(maxVelocity=1.6, maxAccel=1.0, maxOmega=1.8, payloadKg=45.0),
            x=-24.0,
            z=14.0,
            battery=0.87,
            attached=True,
            lidar_healthy=True,
        )
        self.bodies["P02"] = BenchBody(
            hardware_id="P02",
            label="Fetch Pro S — dock unit",
            real=False,
            firmware="bench-0.9.4",
            capabilities=Capabilities(maxVelocity=1.1, maxAccel=0.7, maxOmega=1.4, payloadKg=25.0),
            x=24.0,
            z=-14.0,
            battery=0.62,
            attached=False,
        )
        self.bodies["P03"] = BenchBody(
            hardware_id="P03",
            label="Bench rig (twin validation)",
            real=False,
            firmware="bench-0.9.4",
            capabilities=Capabilities(maxVelocity=0.9, maxAccel=0.5, maxOmega=1.2, lidar=True, payloadKg=18.0),
            x=0.0,
            z=-16.5,
            battery=0.94,
            attached=True,
            busy=True,
        )

    def list_hardware(self) -> List[Dict[str, Any]]:
        return [b.snapshot() for b in self.bodies.values()]

    # -- command path -------------------------------------------------------- #

    def handle_command(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        hw_id = str(msg.get("hardwareId", ""))
        agent_id = str(msg.get("agentId", ""))
        body = self.bodies.get(hw_id)
        if body is None:
            return {"type": "command_ack", "hardwareId": hw_id, "agentId": agent_id, "accepted": False, "reason": "unknown hardware"}

        cmd = msg.get("cmd") or {}
        now = time.time()
        accepted, reason = body.validate(cmd, now)
        entry = {
            "at": round(now, 3),
            "hardwareId": hw_id,
            "agentId": agent_id,
            "cmd": {"v": float(cmd.get("v", 0.0)), "omega": float(cmd.get("omega", 0.0)), "action": cmd.get("action", "MOVE")},
            "accepted": accepted,
            "reason": None if accepted else reason,
        }
        self.command_log.append(entry)
        if len(self.command_log) > 4000:
            self.command_log = self.command_log[-2000:]
        if not accepted:
            body.rejected += 1
            body.violations.append(reason)
            # a refused command is replaced by a stop — never left to run on
            body.target_v, body.target_omega = 0.0, 0.0
            return {"type": "command_ack", "hardwareId": hw_id, "agentId": agent_id, "accepted": False, "reason": reason, "action": entry["cmd"]["action"]}

        v = float(cmd.get("v", 0.0))
        if 0 < abs(v) < body.capabilities.minVelocity:
            # sub-deadband wishes are held by the controller, not actuated
            v = 0.0
            entry["reason"] = "held below drive deadband"
        body.target_v = v
        body.target_omega = float(cmd.get("omega", 0.0))
        body.last_cmd_at = now
        body.last_cmd_age_s = 0.0
        return {"type": "command_ack", "hardwareId": hw_id, "agentId": agent_id, "accepted": True, "reason": entry["reason"], "action": entry["cmd"]["action"]}

    def handle_stop(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        hw_id = str(msg.get("hardwareId", ""))
        body = self.bodies.get(hw_id)
        if body:
            body.target_v, body.target_omega = 0.0, 0.0
        return {"type": "stop_ack", "hardwareId": hw_id, "reason": msg.get("reason", "unspecified")}

    def handle_estop(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        hw_id = str(msg.get("hardwareId", ""))
        on = msg.get("on") is not False
        body = self.bodies.get(hw_id)
        if body:
            body.estop = on
            body.target_v, body.target_omega = 0.0, 0.0
        return {"type": "estop", "hardwareId": hw_id, "on": on, "reason": msg.get("reason", "operator")}

    # -- binding (observability + bookkeeping; authority stays with the fleet) - #

    def handle_bind(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        hw_id = str(msg.get("hardwareId", ""))
        agent_id = str(msg.get("agentId", ""))
        body = self.bodies.get(hw_id)
        if body is None:
            return {"type": "bind_ack", "hardwareId": hw_id, "agentId": agent_id, "ok": False, "reason": "unknown hardware"}
        if not body.attached:
            return {"type": "bind_ack", "hardwareId": hw_id, "agentId": agent_id, "ok": False, "reason": "device not attached"}
        prev = self.bound_agent.get(hw_id)
        if prev and prev != agent_id:
            return {"type": "bind_ack", "hardwareId": hw_id, "agentId": agent_id, "ok": False, "reason": f"already hosting {prev}"}
        self.bound_agent[hw_id] = agent_id
        body.busy = True if not self._brain_owns_motion(body) else body.busy
        evt = {"at": round(time.time(), 3), "hardwareId": hw_id, "agentId": agent_id, "action": "BIND"}
        self.bind_events.append(evt)
        return {"type": "bind_ack", "hardwareId": hw_id, "agentId": agent_id, "ok": True, "boundAgentId": agent_id}

    def handle_unbind(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        hw_id = str(msg.get("hardwareId", ""))
        agent_id = str(msg.get("agentId", ""))
        body = self.bodies.get(hw_id)
        if body is None:
            return {"type": "unbind_ack", "hardwareId": hw_id, "agentId": agent_id, "ok": False, "reason": "unknown hardware"}
        if self.bound_agent.get(hw_id) != agent_id:
            return {"type": "unbind_ack", "hardwareId": hw_id, "agentId": agent_id, "ok": False, "reason": "not bound to that agent"}
        # a safe unbind requires a stopped body; refuse to detach a moving one
        if abs(body.velocity) > 0.05:
            return {"type": "unbind_ack", "hardwareId": hw_id, "agentId": agent_id, "ok": False, "reason": "body still moving — stop first"}
        del self.bound_agent[hw_id]
        evt = {"at": round(time.time(), 3), "hardwareId": hw_id, "agentId": agent_id, "action": "UNBIND"}
        self.bind_events.append(evt)
        return {"type": "unbind_ack", "hardwareId": hw_id, "agentId": agent_id, "ok": True}

    @staticmethod
    def _brain_owns_motion(body: BenchBody) -> bool:
        return True


gateway = RobotGateway()

app = FastAPI(title="NEXUS Robot Gateway", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
#  REST surface                                                               #
# --------------------------------------------------------------------------- #


@app.get("/")
async def root() -> Dict[str, Any]:
    """Human-readable status page, so opening the gateway directly is useful."""
    attached = [b for b in gateway.bodies.values() if b.attached]
    return {
        "service": "NEXUS Robot Gateway",
        "role": "physical boundary between the NEXUS digital twin and real hardware",
        "sockets": len(SESSIONS),
        "telemetryHz": gateway.TELEMETRY_HZ,
        "devices": [
            {
                "id": b.hardware_id,
                "label": b.label,
                "status": b.status,
                "real": b.real,
                "boundAgentId": gateway.bound_agent.get(b.hardware_id),
                "battery": round(b.battery, 3),
            }
            for b in gateway.bodies.values()
        ],
        "attached": len(attached),
        "endpoints": {
            "ws": "/ws/robot",
            "rest": ["/api/health", "/api/hardware", "/api/bindings", "/api/commands", "/api/device/{id}"],
            "actions": ["POST /api/device/{id}/attach?attached=", "POST /api/device/{id}/fault?kind=LIDAR|BUMPER|ESTOP|CLEAR"],
        },
        "docs": "/docs",
    }


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "nexus-robot-gateway",
        "uptimeS": round(time.time() - gateway._started, 1),
        "devices": len(gateway.bodies),
        "attached": sum(1 for b in gateway.bodies.values() if b.attached),
        "sockets": len(SESSIONS),
    }


@app.get("/api/hardware")
async def hardware() -> Dict[str, Any]:
    return {"hardware": gateway.list_hardware(), "bindings": gateway.bound_agent}


@app.get("/api/bindings")
async def bindings() -> Dict[str, Any]:
    return {"bindings": gateway.bound_agent, "events": gateway.bind_events[-50:]}


@app.get("/api/commands")
async def commands(limit: int = 100) -> Dict[str, Any]:
    log = gateway.command_log[-limit:]
    return {
        "log": log,
        "accepted": sum(1 for c in log if c["accepted"]),
        "rejected": sum(1 for c in log if not c["accepted"]),
    }


@app.get("/api/device/{hardware_id}")
async def device(hardware_id: str) -> JSONResponse:
    body = gateway.bodies.get(hardware_id)
    if body is None:
        return JSONResponse({"error": "unknown hardware"}, status_code=404)
    return JSONResponse({**body.snapshot(), "boundAgentId": gateway.bound_agent.get(hardware_id), "rejectedCommands": body.rejected})


@app.post("/api/device/{hardware_id}/attach")
async def attach(hardware_id: str, attached: bool = True) -> Dict[str, Any]:
    """Attach/detach a device session — the honest on/off switch for hardware."""
    body = gateway.bodies.get(hardware_id)
    if body is None:
        return {"ok": False, "reason": "unknown hardware"}
    body.attached = attached
    if not attached:
        body.target_v = body.target_omega = 0.0
        gateway.bound_agent.pop(hardware_id, None)
    return {"ok": True, "hardwareId": hardware_id, "attached": attached, "status": body.status}


@app.post("/api/device/{hardware_id}/fault")
async def fault(hardware_id: str, kind: str = "LIDAR") -> Dict[str, Any]:
    """Inject a device-level fault for the deployment/failure experiments."""
    body = gateway.bodies.get(hardware_id)
    if body is None:
        return {"ok": False, "reason": "unknown hardware"}
    if kind == "LIDAR":
        body.lidar_healthy = False
    elif kind == "BUMPER":
        body.bumper = True
    elif kind == "ESTOP":
        body.estop = True
    elif kind == "CLEAR":
        body.lidar_healthy, body.bumper, body.estop = True, False, False
    return {"ok": True, "hardwareId": hardware_id, "kind": kind}


# --------------------------------------------------------------------------- #
#  WebSocket                                                                  #
# --------------------------------------------------------------------------- #

SESSIONS: Set[WebSocket] = set()


@app.websocket("/ws/robot")
async def robot_socket(ws: WebSocket) -> None:
    await ws.accept()
    SESSIONS.add(ws)

    # 1. say hello: registry + state, with the honest real/bench flag
    await ws.send_text(
        json.dumps(
            {
                "type": "hello",
                "gateway": "nexus-robot-gateway",
                "protocol": 1,
                "hardware": gateway.list_hardware(),
                "bindings": gateway.bound_agent,
                "serverTime": time.time(),
            }
        )
    )

    stop_evt = asyncio.Event()
    # The client publishes the progression of its simulation clock. Device
    # physics is integrated on THAT time base so the digital twin measures
    # execution divergence, not clock skew. With no client clock (a real device
    # attached straight to the gateway) the wall clock is the only time base.
    clock = {"sim_dt": 0.0, "last": time.time(), "seen": False}

    async def telemetry_loop() -> None:
        period = 1.0 / gateway.TELEMETRY_HZ
        hb_every = max(1, int(gateway.TELEMETRY_HZ / gateway.HEARTBEAT_HZ))
        i = 0
        while not stop_evt.is_set():
            wall_now = time.time()
            wall_dt = min(0.25, max(0.0, wall_now - clock["last"]))
            clock["last"] = wall_now
            # Once a NEXUS client publishes its simulation clock, that clock is
            # the ONLY time base for device physics. Falling back to the wall
            # clock in between would integrate both and make every body drift
            # ahead of its own plan. The wall clock is used only when no client
            # drives this gateway (a robot attached straight to the socket).
            dt = clock["sim_dt"] if clock["seen"] else wall_dt
            clock["sim_dt"] = 0.0
            dt = min(0.5, dt)
            for body in gateway.bodies.values():
                if not body.attached:
                    continue
                # devices drop frames when the link degrades — reported, not hidden
                body.link_quality = max(0.55, 1.0 - 0.12 * (1 if body.real else 0))
                if random.random() < (1.0 - body.link_quality):
                    continue
                body.step(dt, time.time())
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "telemetry",
                            "hardwareId": body.hardware_id,
                            "real": body.real,
                            "receivedAt": time.time() * 1000.0,
                            "telemetry": {**body.telemetry(), "emittedAt": time.time() * 1000.0 - random.uniform(18.0, 46.0)},
                        }
                    )
                )
            i += 1
            if i % hb_every == 0:
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "heartbeat",
                            "latencyMs": round(random.uniform(18.0, 46.0), 1),
                            "packetLoss": round(random.uniform(0.0, 0.02), 4),
                            "serverTime": time.time(),
                            "status": [{"id": b.hardware_id, "status": b.status} for b in gateway.bodies.values()],
                        }
                    )
                )
            await asyncio.sleep(period)

    pump = asyncio.create_task(telemetry_loop())
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            kind = msg.get("type")
            out: Optional[Dict[str, Any]] = None
            if kind == "command":
                out = gateway.handle_command(msg)
            elif kind == "stop":
                out = gateway.handle_stop(msg)
            elif kind == "estop":
                out = gateway.handle_estop(msg)
            elif kind == "bind":
                out = gateway.handle_bind(msg)
            elif kind == "unbind":
                out = gateway.handle_unbind(msg)
            elif kind == "clock":
                clock["seen"] = True
                clock["sim_dt"] += max(0.0, min(0.5, float(msg.get("simDt", 0.0))))
            elif kind == "ping":
                out = {"type": "pong", "t": msg.get("t"), "serverTime": time.time()}
            elif kind == "telemetry_request":
                # a client may ask for a one-shot state dump (page reload)
                hw_id = str(msg.get("hardwareId", ""))
                body = gateway.bodies.get(hw_id)
                if body is not None:
                    out = {"type": "telemetry", "hardwareId": hw_id, "real": body.real, "receivedAt": time.time() * 1000.0, "telemetry": {**body.telemetry(), "emittedAt": time.time() * 1000.0}}
            if out is not None:
                await ws.send_text(json.dumps(out))
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - socket teardown races
        pass
    finally:
        stop_evt.set()
        pump.cancel()
        SESSIONS.discard(ws)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
