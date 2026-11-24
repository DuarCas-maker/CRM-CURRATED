import test from "node:test";
import {controlFixture} from "./fixtures/campaign-control";
import {exerciseBounce} from "./fixtures/mail-bounce";
test("bounce persistence, cross-account cancellation, suppression coexistence, MFA unlock and safe rollback",async()=>{
 const f=await controlFixture();try {await exerciseBounce(f);}finally{await f.db.close();}
});
