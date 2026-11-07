import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { AddressController } from './address.controller.js';
import { AddressService } from './address.service.js';
import { AddressExceptionFilter, AddressIdPipe } from './address-http.js';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [AddressController],
  providers: [AddressService, AddressExceptionFilter, AddressIdPipe],
})
export class AddressModule {}
