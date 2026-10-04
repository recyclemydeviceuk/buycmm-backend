import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface TokenPayload {
  sub: string; // admin id
  email: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRE as jwt.SignOptions['expiresIn'], issuer: 'buyupon' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'buyupon' }) as TokenPayload;
  } catch {
    return null;
  }
}
