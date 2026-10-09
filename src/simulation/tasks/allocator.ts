import type { Task, TaskBid, TaskPriority, TaskStep, Vec2, WarehouseObject, Package } from '../../types'
import { priorityRank, type RobotAgent } from '../agents/agent'
import type { WorldAccess } from '../world'

/**
 * TASK ALLOCATION — a sealed-bid auction.
 *
 * The auctioneer is *not* a brain: it does not plan, does not move anyone, and
 * cannot override an agent. It collects the bids each agent computes for itself
 * (Section 16) and awards the task to the lowest cost. Every bid is stored on
 * the task so the UI can show exactly why the winner won.
 */
export class TaskAllocator {
  private seq = 0

  nextId() {
    this.seq++
    return `TASK-${String(this.seq).padStart(3, '0')}`
  }

  /** build a pick→deliver task from a stored package */
  buildTransportTask(
    world: Pick<WorldAccess, 'objects' | 'packages'>,
    packageId: string,
    dropTargetId: string,
    priority: TaskPriority,
    label: string,
    now: number,
    requestedBy: Task['requestedBy'] = 'SCHEDULER',
  ): Task | null {
    const pkg = world.packages.get(packageId)
    if (!pkg) return null
    const origin = world.objects.find((o) => o.id === pkg.locationId)
    const drop = world.objects.find((o) => o.id === dropTargetId)
    if (!origin || !drop) return null
    const id = this.nextId()
    const steps: TaskStep[] = [
      {
        kind: 'PICK',
        targetId: origin.id,
        label: `Pick ${pkg.label} from ${origin.id}`,
        pose: origin.pickFace ?? { x: origin.rect.x, z: origin.rect.z },
        status: 'PENDING',
      },
      {
        kind: 'DROP',
        targetId: drop.id,
        label: `Deliver ${pkg.label} to ${drop.id}`,
        pose: drop.pickFace ?? { x: drop.rect.x, z: drop.rect.z },
        status: 'PENDING',
      },
    ]
    return {
      id,
      label,
      priority,
      status: 'QUEUED',
      steps,
      currentStep: 0,
      packageId,
      assignedTo: null,
      assignedAt: null,
      createdAt: now,
      completedAt: null,
      evaluation: [],
      history: [],
      requestedBy,
      reassignmentCount: 0,
    }
  }

  /**
   * Run one auction round. Returns the winning bid (or null when nobody is
   * capable / available). `evaluations` is always written to the task, even on
   * failure, so the UI can show the fleet's reasoning.
   */
  auction(task: Task, agents: RobotAgent[], world: WorldAccess, now: number) {
    const capable: TaskBid[] = []
    const all: TaskBid[] = []
    for (const agent of agents) {
      if (!world.isAgentAvailable(agent.id)) {
        all.push({
          agentId: agent.id,
          cost: Number.POSITIVE_INFINITY,
          distanceM: 0,
          battery: agent.battery,
          workload: 0,
          etaS: 0,
          congestionPenalty: 0,
          capable: false,
          accepted: false,
          note: agent.fault ? `unavailable: ${agent.fault}` : 'offline',
        })
        continue
      }
      if (agent.task && agent.task.id !== task.id) {
        const held = agent.task
        // A robot whose task was just REASSIGNED may preempt a *lower priority*
        // task — but never while it is carrying a package, and never within 5 s
        // of taking the job on (that would make the fleet thrash).
        const staleWork = now - (held.assignedAt ?? now) > 45
        const canPreempt =
          task.status === 'REASSIGNING' &&
          held.status !== 'REASSIGNING' && // never cascade a reassignment
          !agent.carrying &&
          now - (held.assignedAt ?? now) > 8 &&
          now - agent.memory.lastPreemptedAt > 25 && // no hot-potato
          (priorityRank(task.priority) > priorityRank(held.priority) || staleWork)
        const bid = agent.bidOnTask(task, world)
        if (canPreempt) {
          bid.cost = 2.0
          bid.note = `preempts ${held.id} (${held.priority}${staleWork ? ', stale >30 s' : ''}) for a ${task.priority} reassignment`
          all.push(bid)
          capable.push(bid)
        } else {
          bid.note = `busy with ${held.id} — ${held.priority} task, no preemption`
          all.push(bid)
        }
        continue
      }
      const bid = agent.bidOnTask(task, world)
      all.push(bid)
      if (bid.capable) capable.push(bid)
    }
    all.sort((a, b) => a.cost - b.cost)
    task.evaluation = all
    if (capable.length === 0) {
      task.history.push({ at: now, event: 'AUCTION_EMPTY', detail: 'no capable or available agent' })
      return null
    }
    capable.sort((a, b) => a.cost - b.cost)
    const winner = capable[0]
    winner.accepted = true
    task.assignedTo = winner.agentId
    task.assignedAt = now
    task.status = 'ASSIGNED'
    task.history.push({
      at: now,
      event: 'AWARDED',
      detail: `${winner.agentId} won with cost ${winner.cost.toFixed(2)} (${winner.distanceM.toFixed(1)} m, ${((winner.battery ?? 0) * 100) | 0}% battery)`,
    })
    const agent = agents.find((a) => a.id === winner.agentId)!
    // hand the preempted job back to the market before re-tasking this robot
    if (agent.task && agent.task.id !== task.id) {
      const preempted = agent.task
      agent.memory.lastPreemptedAt = now
      world.releaseTask(preempted.id, agent.id, `preempted by ${task.id} (${task.priority} reassignment)`)
    }
    agent.acceptTask(task)
    return winner
  }
}
