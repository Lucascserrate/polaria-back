import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { GoogleUserDto } from './dto/google-user.dto';

type GoogleAuthRequest = Request & { user: GoogleUserDto };
type JwtAuthRequest = Request & {
  user: { sub: string; email?: string | null };
};
type RefreshRequest = Request & { cookies?: { refreshToken?: string } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleLogin() {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleLoginRedirect(
    @Req() req: GoogleAuthRequest,
    @Res() res: Response,
  ) {
    return this.authService.OAuthCallback(req.user, res);
  }

  @Post('refreshToken')
  refreshToken(@Req() req: RefreshRequest) {
    const refreshToken = req.cookies?.refreshToken ?? '';
    return this.authService.refreshToken(refreshToken);
  }

  @Get('validateToken')
  @UseGuards(AuthGuard('jwt'))
  validateToken(@Req() req: JwtAuthRequest) {
    return this.authService.validateTenant(req.user);
  }
}
