export interface AuthenticationResult {
  authenticated: boolean;
  /** Mensagem diagnóstica; nunca deve conter cookies ou tokens. */
  message?: string;
}
