import type { User, UserId } from '../models/user.js';
import { UserRepository } from '../repositories/user-repo.js';
import { formatName } from '../utils/strings.js';

let nextId = 1;

function makeId(): UserId {
  return `user-${nextId++}`;
}

/** Business rules for user management. */
export class UserService {
  constructor(private repo: UserRepository) {}

  /** Register a new user. */
  create(name: string, email: string): User {
    const user: User = {
      id: makeId(),
      name: formatName(name),
      email,
    };
    return this.repo.save(user);
  }

  /** Fetch a user by id. */
  findById(id: UserId): User | undefined {
    return this.repo.findById(id);
  }

  /** Number of registered users. */
  total(): number {
    return this.repo.count();
  }
}
