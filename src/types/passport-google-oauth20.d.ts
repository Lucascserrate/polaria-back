declare module 'passport-google-oauth20' {
  export interface Profile {
    id: string;
    displayName: string;
    emails?: Array<{ value: string }>;
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    passReqToCallback?: boolean;
    scope?: string[];
  }

  // Minimal Strategy typing to satisfy NestJS PassportStrategy usage.
  export class Strategy {
    constructor(options: StrategyOptions, verify?: (...args: any[]) => any);
  }
}
