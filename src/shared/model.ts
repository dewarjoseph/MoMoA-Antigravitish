// --- Type Definitions ---

export enum ServerMode {
   ORCHESTRATOR = 'orchestrator',
   ANALYZER = 'analyzer',
   ENRICH_AND_DECONSTRUCT = "ENRICH_AND_DECONSTRUCT",
   IDENTIFY_NEXT_TASK = "IDENTIFY_NEXT_TASK"
};

/**
 * Defines the structure for the data in an 'INITIAL_REQUEST_PARAMS' message,
 * matching the Python client's payload but without files.
 */
export interface InitialRequestData {
  prompt: string;
  image?: string; // Optional Base64 encoded image data
  imageMimeType?: string; // Optional MIME type of the attached image
  llmName: string;
  githubUrl?: string;
  maxTurns?: number;
  assumptions?: string; // Client sends a single string
  files?: { name: string; content: string }[]; // This will be populated by chunks
  saveFiles?: boolean;
  secrets: UserSecrets;
  mode?: ServerMode; //'orchestrator' | 'analyzer';
  projectId?: string;
  projectSpecification?: string;
  environmentInstructions?: string;
  notWorkingBuild?: boolean;
  weaveId?: string;
  maxDurationMs?: number;
  gracePeriodMs?: number;
}

export interface UserSecrets {
  geminiApiKey: string;
  julesApiKey: string;
  githubToken: string;
  stitchApiKey: string;
  e2BApiKey: string;
  githubScratchPadRepo: string;
}

/**
 * Structured message emitted by the orchestrator for logging.
 */
export interface OutgoingMessage {
  status:
    | "USER_MESSAGE"
    | "WORK_LOG"
    | "ERROR"
    | "PROGRESS_UPDATES"
    | "COMPLETE_RESULT"
    | (string & {});
  message?: string;
  completed_status_message?: string;
  current_status_message?: string;
  data?: {
    feedback?: string;
    files?: string;
    result?: string;
    retrospective?: string;
  };
}