export interface VersionSaveRequest<TContent> { baseVersionId: string; content: TContent; clientMutationId: string }

export interface SaveCoordinatorOptions<TContent, TResult> {
  debounceMs: number;
  prepare: (content: TContent) => VersionSaveRequest<TContent>;
  save: (request: VersionSaveRequest<TContent>) => Promise<TResult>;
  onSaved: (result: TResult, request: VersionSaveRequest<TContent>) => void;
  onFailed: (error: unknown, request: VersionSaveRequest<TContent>) => void;
}

/** Serializes version commands so an editor never has more than one write in flight. */
export class SaveCoordinator<TContent, TResult> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queuedContent: TContent | null = null;
  private inFlight = false;
  private failedRequest: VersionSaveRequest<TContent> | null = null;

  constructor(private readonly options: SaveCoordinatorOptions<TContent, TResult>) {}

  schedule(content: TContent): void {
    this.queuedContent = content;
    if (this.inFlight) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.runQueued(); }, this.options.debounceMs);
  }

  flush(content?: TContent): void {
    if (content !== undefined) this.queuedContent = content;
    if (this.inFlight) return;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    void this.runQueued();
  }

  retryFailed(): void {
    if (this.inFlight || this.failedRequest === null) return;
    const request = this.failedRequest; this.failedRequest = null; void this.run(request);
  }

  dispose(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }

  private async runQueued(): Promise<void> {
    if (this.inFlight || this.queuedContent === null) return;
    const content = this.queuedContent; this.queuedContent = null;
    await this.run(this.options.prepare(content));
  }

  private async run(request: VersionSaveRequest<TContent>): Promise<void> {
    this.inFlight = true;
    try { const result = await this.options.save(request); this.options.onSaved(result, request); }
    catch (error) { this.failedRequest = request; this.options.onFailed(error, request); }
    finally { this.inFlight = false; if (this.queuedContent !== null) await this.runQueued(); }
  }
}
