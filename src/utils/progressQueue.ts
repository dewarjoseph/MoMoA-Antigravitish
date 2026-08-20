// --- Queue System for Progress Updates (Headless) ---
interface ProgressQueueItem {
  id: number;
  resolved: boolean;
  value?: string;
  error?: boolean;
  addedAt: number;
}

export class ProgressQueue {
  private queue: ProgressQueueItem[] = [];
  private idCounter = 0;

  constructor(
    private onUpdate: (message: string, isError: boolean) => void = (msg, err) => {
      if (err) console.error(`[ProgressQueue Error]: ${msg}`);
      else console.log(`[ProgressQueue Update]: ${msg}`);
    },
    private clientUUID: string = "headless"
  ) {}

  add(message: string | Promise<string>) {
    const item: ProgressQueueItem = {
      id: this.idCounter++,
      resolved: false,
      addedAt: Date.now(),
    };
    
    this.queue.push(item);

    if (typeof message === 'string') {
      item.resolved = true;
      item.value = message;
      this.process();
    } else {
      message
        .then(val => {
          item.resolved = true;
          item.value = val;
          queueMicrotask(() => this.process());
        })
        .catch(err => {
          console.error(`Progress update promise failed:`, err);
          item.error = true;
          item.value = err instanceof Error ? err.message : String(err);
          queueMicrotask(() => this.process());
        });

      setTimeout(() => this.process(), 30050);
    }
  }

  process() {
    while (this.queue.length > 0) {
      const head = this.queue[0];
      
      if (head.error) {
        this.onUpdate(`Update failed: ${head.value}`, true);
        this.queue.shift();
        continue;
      }

      if (head.resolved) {
        this.onUpdate(head.value || "", false);
        this.queue.shift();
        continue;
      }

      const timeInQueue = Date.now() - head.addedAt;
      const hasFinishedSubsequent = this.queue.slice(1).some(q => q.resolved || q.error);

      if (timeInQueue >= 29900 && hasFinishedSubsequent) {
        console.log(`Sending timeout payload for unresolved progress update (client ${this.clientUUID}).`);
        this.onUpdate(`Update failed: Operation timed out after 30 seconds`, true);
        this.queue.shift(); 
        continue;
      }

      break; 
    }
  }
}