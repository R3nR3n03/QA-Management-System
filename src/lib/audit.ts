type AuditInput = {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
  beforeAfterJson: unknown;
};

type AuditWriter = {
  auditEvent: {
    create: (args: {
      data: {
        actorId: string;
        action: string;
        entityType: string;
        entityId: string;
        requestId: string;
        beforeAfterJson: object;
      };
    }) => Promise<unknown>;
  };
};

export async function appendAudit(db: AuditWriter, input: AuditInput) {
  await db.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      beforeAfterJson: input.beforeAfterJson as object
    }
  });
}
