import {
  Controller,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { GoogleUserDto } from './dto/google-user.dto';

type GoogleAuthRequest = Request & { user: GoogleUserDto };
type JwtAuthRequest = Request & {
  user: { sub: string; email?: string | null };
};
type RefreshRequest = Request & { cookies?: { refreshToken?: string } };

const headerValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? 'undefined') : (value ?? 'undefined');

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

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
    this.logger.log(
      `Google callback hit origin=${headerValue(req.headers.origin)} host=${headerValue(req.headers.host)} proto=${headerValue(req.headers['x-forwarded-proto'])} userAgent=${headerValue(req.headers['user-agent'])}`,
    );
    return this.authService.OAuthCallback(req.user, res);
  }

  @Post('refreshToken')
  refreshToken(@Req() req: RefreshRequest) {
    this.logger.log(
      `refreshToken called cookiePresent=${Boolean(req.cookies?.refreshToken)} origin=${headerValue(req.headers.origin)} host=${headerValue(req.headers.host)}`,
    );
    const refreshToken = req.cookies?.refreshToken ?? '';
    return this.authService.refreshToken(refreshToken);
  }

  @Get('validateToken')
  @UseGuards(AuthGuard('jwt'))
  validateToken(@Req() req: JwtAuthRequest) {
    return this.authService.validateTenant(req.user);
  }

  @Post('logout')
  logout(@Res() res: Response) {
    this.logger.log('logout called, clearing auth cookies');
    const cookieOptions: CookieOptions = {
      secure: true,
      sameSite: 'none',
    };
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);

    return res.status(200).json({ message: 'Logged out successfully' });
  }
}
