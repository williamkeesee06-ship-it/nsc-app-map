// Shared types for NSC APP MAP — used by both web and api workspaces.
// Geodesic helpers for the 811 dig polygon tool (area/perimeter/bounds).
export * from "./geo.js";
export const emptyAsbuilt = (jobId) => ({
    jobId,
    points: [],
    lines: [],
    updatedAt: Date.now(),
    schemaVersion: 1,
});
// A ticket may only be deleted while it has not been successfully filed with
// ITIC: drafts, failed attempts, or anything without a real ITIC ticket number.
// Filed/Active tickets (or any ticket that carries an ITIC number) are locked.
// Enforced server-side (403) and mirrored client-side to hide the delete UI.
export function canDeleteDigTicket(ticket) {
    if (ticket.ticketNumber && ticket.ticketNumber.trim() !== "")
        return false;
    return ticket.status !== "Filed" && ticket.status !== "Active";
}
