import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { VerifiedCallback } from 'passport-jwt';
import { GoogleUserDto } from '../dto/google-user.dto';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
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
    req: unknown,
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifiedCallback,
  ) {
    const user: GoogleUserDto = {
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName,
    };

    done(null, user);
  }
}
