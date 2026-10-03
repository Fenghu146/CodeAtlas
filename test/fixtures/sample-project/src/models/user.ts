/** A user record in the system. */
export interface User {
  id: string;
  name: string;
  email: string;
}

/** Primary key alias for users. */
export type UserId = string;
