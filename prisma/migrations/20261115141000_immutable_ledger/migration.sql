-- Financial rows are append-only. Corrections must insert linked reversals.
CREATE TRIGGER immutable_entry_update BEFORE UPDATE ON "Entry"
BEGIN SELECT RAISE(ABORT, 'Ledger entries cannot be overwritten. Insert a reversal.'); END;
CREATE TRIGGER immutable_entry_delete BEFORE DELETE ON "Entry"
BEGIN SELECT RAISE(ABORT, 'Ledger entries cannot be deleted. Insert a reversal.'); END;
CREATE TRIGGER immutable_audit_update BEFORE UPDATE ON "Audit"
BEGIN SELECT RAISE(ABORT, 'Audit records are append-only.'); END;
CREATE TRIGGER immutable_audit_delete BEFORE DELETE ON "Audit"
BEGIN SELECT RAISE(ABORT, 'Audit records are append-only.'); END;
CREATE TRIGGER valid_entry BEFORE INSERT ON "Entry"
WHEN NEW.kind NOT IN ('credit','payment','reversal')
  OR (NEW.kind IN ('credit','payment') AND (NEW.amountPaise < 1 OR NEW.amountPaise > 100000000 OR NEW.reversesId IS NOT NULL))
  OR (NEW.kind = 'reversal' AND (NEW.reversesId IS NULL OR ABS(NEW.amountPaise) > 100000000))
BEGIN SELECT RAISE(ABORT, 'Invalid ledger entry.'); END;
