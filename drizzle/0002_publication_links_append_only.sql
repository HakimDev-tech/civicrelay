-- Keep publication capability records as an auditable lifecycle ledger.
CREATE TRIGGER publication_links_no_delete
BEFORE DELETE ON publication_links
FOR EACH ROW EXECUTE FUNCTION civicrelay_reject_immutable_mutation();
