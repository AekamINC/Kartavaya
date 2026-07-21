-- 048: Remove helpdesk/support tickets feature
DROP TABLE IF EXISTS staging.graha_ticket_messages;
DROP TABLE IF EXISTS staging.graha_tickets;
DROP INDEX IF EXISTS staging.idx_tickets_org;
DROP INDEX IF EXISTS staging.idx_tickets_contact;
DROP INDEX IF EXISTS staging.idx_ticket_messages;
