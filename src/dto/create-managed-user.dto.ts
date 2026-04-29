export class CreateManagedUserDto {
  email!: string;
  password!: string;
  fullName?: string;
  role?: string;
  isActive?: boolean;
}