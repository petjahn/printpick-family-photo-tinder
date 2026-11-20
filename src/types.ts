export type PhotoStatus = 'pending' | 'print' | 'delete' | 'shown' | 'printed';

export interface PhotoRecord {
  id: string;
  filename: string;
  mimeType: string;
  createTime: string;
  width: number;
  height: number;
  status: PhotoStatus;
  previousStatus?: PhotoStatus | null;
  isFavorite?: boolean;
  thumbDataUrl: string;
  previewDataUrl?: string | null;
  baseUrl?: string;
  baseUrlExpiresAt?: number;
  pickedOrder?: number;
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
  isFavorite?: boolean;
  thumbDataUrl: string;
  previewDataUrl?: string;
  displayUrl: string;
  baseUrl?: string;
  baseUrlExpiresAt?: number;
  pickedOrder?: number;
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
