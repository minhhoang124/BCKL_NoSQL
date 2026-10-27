import type { ExecutionContext } from '@nestjs/common';
import { afterEach,expect,it,vi } from 'vitest';
import { AuthEmailRateGuard } from './email-recovery.controller.js';
afterEach(()=>vi.unstubAllEnvs());
function ctx(ip='127.0.0.1',forward=''){
 return {switchToHttp:()=>({getRequest:()=>({socket:{remoteAddress:ip},headers:{'x-forwarded-for':forward}}),getResponse:()=>({setHeader:vi.fn()})})} as unknown as ExecutionContext;
}
it('fails closed while rollout disabled',()=>{vi.stubEnv('AUTH_EMAIL_ENABLED','false');expect(()=>new AuthEmailRateGuard().canActivate(ctx())).toThrow();});
it('bounds anonymous confirm attempts before bcrypt and ignores spoofed forwarded headers',()=>{
 vi.stubEnv('AUTH_EMAIL_ENABLED','true');const guard=new AuthEmailRateGuard();for(let n=0;n<10;n++)expect(guard.canActivate(ctx('127.0.0.1',`forged-${n}`))).toBe(true);expect(()=>guard.canActivate(ctx('127.0.0.1','new-forged'))).toThrow();expect(guard.canActivate(ctx('127.0.0.2'))).toBe(true);
});
