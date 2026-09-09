export class ApiError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 422 | 503, public code: string, message: string) {
    super(message)
  }
}
export function fail(status: ApiError['status'], code: string, message: string): never {
  throw new ApiError(status, code, message)
}
