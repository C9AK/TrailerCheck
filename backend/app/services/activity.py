"""Unified lifecycle event recording.

Every state-changing action writes BOTH:
  - audit_logs   (normalized, powers stats/history queries), and
  - live_activity_feed (immutable denormalized snapshot + rendered message
    for the manager live feed and dispute resolution).
"""

from sqlalchemy.orm import Session

from app.models import AuditEvent, AuditLog, LiveActivityFeed, PickupTicket, TicketState, User


def _render_message(ticket: PickupTicket, actor: User, event: AuditEvent) -> str:
    truck = ticket.truck_number
    mc = ticket.motor_carrier.name
    employee = ticket.creator.username

    if event == AuditEvent.TICKET_CREATED:
        destination = (
            "sent it to QC"
            if ticket.state == TicketState.PENDING_QC
            else "saved it to Carryover"
        )
        return f"{actor.username} created a pickup ticket for truck {truck} ({mc}) and {destination}"
    if event == AuditEvent.TICKET_SENT_TO_QC:
        return f"{actor.username} completed ticket for truck {truck} ({mc}) and sent it to QC"
    if event == AuditEvent.TICKET_FLAGGED:
        return f"{actor.username} Flagged ticket for truck {truck} ({mc}) and sent back to {employee}"
    if event == AuditEvent.TICKET_RESOLVED:
        if ticket.is_urgent_flag and actor.id != ticket.created_by:
            return (
                f"{actor.username} resolved URGENT flag on truck {truck} ({mc}) "
                f"for {employee} and returned it to QC (teamwork bonus)"
            )
        return f"{actor.username} resolved flagged errors for truck {truck} ({mc}) and returned it to QC"
    if event == AuditEvent.TICKET_APPROVED:
        if ticket.is_unresolvable:
            return (
                f"{actor.username} FORCE-approved ticket for truck {truck} ({mc}) despite an "
                f"unresolvable exception ({ticket.unresolvable_reason or 'no reason recorded'}) "
                f"— approval credit to {employee}"
            )
        return f"{actor.username} approved ticket for truck {truck} ({mc}) — approval credit to {employee}"
    if event == AuditEvent.TICKET_UNRESOLVABLE:
        return (
            f"{actor.username} marked truck {truck} ({mc}) UNRESOLVABLE and escalated it to QC "
            f"— reason: {ticket.unresolvable_reason or ''}"
        )
    if event == AuditEvent.TICKET_DROPPED:
        return (
            f"{actor.username} marked truck {truck} ({mc}) as DROPPED — "
            f"trailer dropped, pickup can no longer be processed"
        )
    if event == AuditEvent.TICKET_DELETED:
        return f"{actor.username} deleted pickup ticket for truck {truck} ({mc})"
    return f"{actor.username} updated ticket for truck {truck} ({mc})"


def record_event(db: Session, ticket: PickupTicket, actor: User, event: AuditEvent) -> None:
    db.add(AuditLog(ticket_id=ticket.id, actor_id=actor.id, event=event))
    db.add(
        LiveActivityFeed(
            ticket_id=ticket.id,
            event=event,
            actor_id=actor.id,
            actor_username=actor.username,
            employee_username=ticket.creator.username,
            truck_number=ticket.truck_number,
            mc_name=ticket.motor_carrier.name,
            message=_render_message(ticket, actor, event),
        )
    )
