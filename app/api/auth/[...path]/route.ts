import { getAuth } from '@/lib/auth/server';

export async function GET(request: Request) {
  return getAuth().handler().GET(request);
}

export async function POST(request: Request) {
  return getAuth().handler().POST(request);
}
