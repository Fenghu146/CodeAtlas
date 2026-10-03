import { UserRepository } from './repositories/user-repo.js';
import { UserService } from './services/user-service.js';
import { UserHandler } from './api/user-handler.js';

const repo = new UserRepository();
const service = new UserService(repo);
const handler = new UserHandler(service);

/** Boot the application. */
export function main(): void {
  const user = handler.createUser('  Ada   Lovelace ', 'ada@example.com');
  console.log(handler.getUser(user.id));
  console.log(handler.userCount());
}

main();
