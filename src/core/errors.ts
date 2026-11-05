export type DomainErrorCode = 'validation' | 'not_found' | 'duplicate' | 'invalid_transition' | 'requirement_missing' | 'provider_error';

export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
