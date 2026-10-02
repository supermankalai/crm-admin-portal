/**
 * Expected, user-facing failures. Anything else is logged with details on the server and shown
 * to the user as a generic message (never a stack trace).
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, "not_found", 404);
  }
}

export class GymReadOnlyError extends AppError {
  constructor(message = "This gym is read-only until its subscription is renewed.") {
    super(message, "read_only", 409);
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {}
  ) {
    super(message, "validation", 422);
  }
}
