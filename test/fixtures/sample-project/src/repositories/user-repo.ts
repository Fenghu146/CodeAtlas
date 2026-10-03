import type { User, UserId } from '../models/user.js';

/** Persistence layer for users. */
export class UserRepository {
  private records: Map<string, User> = new Map();

  /** Insert or update a user record. */
  save(user: User): User {
    this.records.set(user.id, user);
    return user;
  }

  /** Look up a user by id. */
  findById(id: UserId): User | undefined {
    return this.records.get(id);
  }

  /** Count stored users. */
  count(): number {
    return this.records.size;
  }
}
