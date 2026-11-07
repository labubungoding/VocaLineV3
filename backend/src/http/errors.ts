export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown> | undefined;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static unauthorized() {
    return new ApiError(401, 'unauthorized', 'Sesi tidak valid, silakan login ulang');
  }
  static forbidden(msg: string) {
    return new ApiError(403, 'forbidden', msg);
  }
  static notFound(what: string) {
    return new ApiError(404, 'not_found', `${what} tidak ditemukan`);
  }
  static conflict(code: string, msg: string, details?: Record<string, unknown>) {
    return new ApiError(409, code, msg, details);
  }
  static invalid(code: string, msg: string, details?: Record<string, unknown>) {
    return new ApiError(422, code, msg, details);
  }
  static mlUnavailable() {
    return new ApiError(503, 'ml_unavailable', 'Layanan AI sedang tidak terhubung');
  }
  static rateLimited() {
    return new ApiError(429, 'rate_limited', 'Terlalu banyak permintaan');
  }
}

export function errorBody(code: string, message: string, details?: Record<string, unknown>) {
  const err: Record<string, unknown> = { code, message };
  if (details) err.details = details;
  return { error: err };
}
