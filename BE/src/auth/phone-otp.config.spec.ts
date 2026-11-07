import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { phoneOtpConfig } from './phone-otp.config.js';
const values={AUTH_PHONE_OTP_ENABLED:'true',AUTH_PHONE_OTP_PROVIDER:'sandbox',AUTH_PHONE_OTP_HMAC_SECRET:'synthetic-phone-sandbox-key-at-least32bytes',NODE_ENV:'test',DATABASE_URL:'postgresql://qa:synthetic@127.0.0.1:5549/bckl_order_resolution_test_phone_unit?schema=public',GITHUB_ACTIONS:'false'};
beforeEach(()=>{for(const[k,v]of Object.entries(values))vi.stubEnv(k,v);});afterEach(()=>vi.unstubAllEnvs());
describe('phone mock environment gate',()=>{
 it('allows isolated QA sandbox explicitly',()=>expect(phoneOtpConfig().channel).toBe('SANDBOX'));
 it.each([['AUTH_PHONE_OTP_ENABLED','false'],['AUTH_PHONE_OTP_PROVIDER','real'],['AUTH_PHONE_OTP_HMAC_SECRET','short'],['NODE_ENV','production'],['DATABASE_URL','postgresql://qa:synthetic@127.0.0.1:5432/klcn_ecommerce'],['DATABASE_URL','postgresql://qa:synthetic@remote.invalid:5549/bckl_order_resolution_test_phone'],['DATABASE_URL','postgresql://qa:synthetic@127.0.0.1:5549/bckl_order_resolution_test_phone?schema=public&schema=public'],['DATABASE_URL','postgresql://qa:synthetic@127.0.0.1:5549/bckl_order_resolution_test_phone?sslmode=disable']])('refuses unsafe %s', (k,v)=>{vi.stubEnv(k,v);expect(()=>phoneOtpConfig()).toThrow();});
});
