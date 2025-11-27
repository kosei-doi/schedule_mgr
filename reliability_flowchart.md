## Reliability Logic Enhancements

- **Input validation & normalization** before persisting ensures malformed events (e.g., invalid ranges or malformed recurrence rules) never reach Firebase or Google sync.
- **Optimistic UI with offline queue** lets users keep working while connectivity is lost; queued mutations replay once Firebase reconnects.
- **Conflict detection** compares `updatedAt`/`lastWriteClientId` so the app prompts on concurrent edits rather than silently overwriting.
- **Retry with backoff** wraps network operations (Firebase writes, Google Apps Script calls) to avoid data loss on transient failures.
- **Integrity checks** (hash or schema version) run after imports and before exports to catch corrupted payloads early.

```mermaid
flowchart TD
    A[User creates/edits event] --> B[Client validation + normalization]
    B -->|fails| M[Show error + keep form open]
    B -->|passes| C{Online?}
    C -->|No| D[Store mutation in offline queue + optimistic UI update]
    D --> E[Monitor connectivity]
    E -->|Reconnected| F[Replay queued mutations in order]
    C -->|Yes| G[Write to Firebase with metadata: updatedAt + lastWriteClientId]
    F --> G
    G --> H{Write success}
    H -->|No| I[Retry with exponential backoff + alert after max attempts]
    H -->|Yes| J[Refresh events via onValue listener]
    J --> K[Schedule notifications + rerender views]
    J --> L[Queue Google sync job, debounced]
    L --> N[Sync to Google via Apps Script with conflict checks]
```

