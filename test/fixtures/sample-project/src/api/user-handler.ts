import { truncate } from '../utils/strings.js';
import { UserService } from '../services/user-service.js';

/** Interface-layer handler for user endpoints. */
export class UserHandler {
  constructor(private service: UserService) {}

  /** Handle POST /users. */
  createUser(name: string, email: string) {
    return this.service.create(name, email);
  }

  /** Handle GET /users/:id. */
  getUser(id: string): string {
    const user = this.service.findById(id);
    return user ? truncate(user.name, 24) : 'unknown';
  }

  /** Handle GET /users/count. */
  userCount(): number {
    return this.service.total();
  }
}
