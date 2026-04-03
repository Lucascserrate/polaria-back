import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Profile,
  Strategy as GoogleOAuthStrategy,
} from 'passport-google-oauth20';
import { Request } from 'express';
import { GoogleUserDto } from '../dto/google-user.dto';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  GoogleOAuthStrategy,
  'google',
) {
  constructor() {
    const clientID = process.env.GOOGLE_CLIENT_ID ?? '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
    const callbackURL = process.env.GOOGLE_CALLBACK_URL ?? '';
    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error('Missing Google OAuth environment variables.');
    }
    super({
      clientID,
      clientSecret,
      callbackURL,
      passReqToCallback: true,
      scope: ['email', 'profile', 'openid'],
    });
  }

  validate(
    req: Request,
    accessToken: string,
    refreshToken: string,
    profile: Profile,
  ): GoogleUserDto {
    const user: GoogleUserDto = {
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName,
    };

    return user;
  }
}
