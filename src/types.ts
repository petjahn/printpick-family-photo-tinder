export type PhotoStatus = 'print' | 'delete' | 'shown' | 'printed';

export interface PhotoRecord {
  id: string;
  filename: string;
  mimeType: string;
  createTime: string;
  width: number;
  height: number;
  status: PhotoStatus;
  previousStatus?: PhotoStatus | null;
  thumbDataUrl: string;
  baseUrl?: string;
  baseUrlExpiresAt?: number;
  updatedAt: number;
  updatedBy: string;
}

export interface CandidatePhoto {
  id: string;
  filename: string;
  mimeType: string;
  createTime: string;
  width: number;
  height: number;
  thumbDataUrl: string;
  displayUrl: string;
  baseUrl?: string;
  baseUrlExpiresAt?: number;
}

export interface UndoAction {
  photo: CandidatePhoto;
  previousRecord: PhotoRecord | null;
  appliedStatus: PhotoStatus;
}

export interface RuntimeConfig {
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  firebaseAppId: string;
  googleClientId: string;
  allowedEmails: string[];
}
