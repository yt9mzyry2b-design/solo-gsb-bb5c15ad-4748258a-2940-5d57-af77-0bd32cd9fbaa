import type {
  DecodeRequest,
  DecodeResponse,
  EncodeRequest,
  EncodeResponse,
} from '@jacquard/shared';

async function post<TReq, TRes>(url: string, body: TReq): Promise<TRes> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(data?.error ?? `请求失败（HTTP ${res.status}）`);
  }
  return (await res.json()) as TRes;
}

export const api = {
  encode: (body: EncodeRequest) => post<EncodeRequest, EncodeResponse>('/api/encode', body),
  decode: (body: DecodeRequest) => post<DecodeRequest, DecodeResponse>('/api/decode', body),
};
