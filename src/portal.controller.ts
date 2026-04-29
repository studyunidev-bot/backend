import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { PortalService } from './portal.service';

@Controller('portal')
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Get('students/:nationalId')
  async getStudentSearch(@Param('nationalId') nationalId: string) {
    return this.portalService.getStudentSearch(nationalId);
  }

  @Get('applications/:id')
  async getApplicationDetail(@Param('id') id: string) {
    return this.portalService.getApplicationDetail(id);
  }

  @Patch('applications/:id/forfeit')
  async forfeitApplication(
    @Param('id') id: string,
    @Body()
    body: {
      reason?: string;
      fullName?: string;
      address?: string;
      phone?: string;
    },
  ) {
    return this.portalService.forfeitApplication(id, body);
  }

  @Get('settings')
  async getSettings() {
    return this.portalService.getPublicSettings();
  }
}