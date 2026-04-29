import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersService } from './users.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { CheckInController } from './checkin.controller';
import { CheckInService } from './checkin.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { UsersController } from './users.controller';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';
import { ForfeitRequestsController } from './forfeit-requests.controller';
import { ForfeitRequestsService } from './forfeit-requests.service';

@Module({
  imports: [PrismaModule],
  controllers: [AppController, AuthController, UsersController, ImportsController, CheckInController, DashboardController, EnrollmentsController, PortalController, StudentsController, SystemSettingsController, ForfeitRequestsController],
  providers: [
    AppService,
    UsersService,
    ImportsService,
    CheckInService,
    DashboardService,
    EnrollmentsService,
    AuthService,
    TokenService,
    RolesGuard,
    PortalService,
    StudentsService,
    SystemSettingsService,
    ForfeitRequestsService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
