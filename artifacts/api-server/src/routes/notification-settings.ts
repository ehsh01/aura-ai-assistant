import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  getNotificationSettingsForUser,
  InvalidPhoneNumberError,
  InvalidTimeError,
  InvalidTimezoneError,
  updateNotificationSettingsForUser,
} from "../services/notification-settings";
import { NoPhoneNumberError, sendTestSmsReminder, SmsNotConfiguredError } from "../services/sms-reminders";
import { smsService } from "../services/sms";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/settings/notifications", async (req, res, next) => {
  try {
    const settings = await getNotificationSettingsForUser(req.user!.id);
    res.json({ ...settings, smsConfigured: smsService.enabled });
  } catch (err) {
    next(err);
  }
});

const UpdateBody = z.object({
  phoneNumber: z.string().max(32).nullable().optional(),
  smsRemindersEnabled: z.boolean().optional(),
  smsInboundEnabled: z.boolean().optional(),
  smsLeadMinutes: z.number().int().optional(),
  timezone: z.string().max(64).nullable().optional(),
  morningBriefingEnabled: z.boolean().optional(),
  morningBriefingTime: z.string().max(5).optional(),
  eveningCheckinEnabled: z.boolean().optional(),
  eveningCheckinTime: z.string().max(5).optional(),
  quietHoursStart: z.string().max(5).optional(),
  quietHoursEnd: z.string().max(5).optional(),
});

router.put("/settings/notifications", async (req, res, next) => {
  try {
    const body = UpdateBody.parse(req.body ?? {});
    const settings = await updateNotificationSettingsForUser(req.user!.id, body);
    res.json({ ...settings, smsConfigured: smsService.enabled });
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      res.status(400).json({ error: "INVALID_PHONE", message: err.message });
      return;
    }
    if (err instanceof InvalidTimeError || err instanceof InvalidTimezoneError) {
      res.status(400).json({ error: "INVALID_SETTING", message: err.message });
      return;
    }
    next(err);
  }
});

router.post("/settings/notifications/test", async (req, res, next) => {
  try {
    const settings = await getNotificationSettingsForUser(req.user!.id);
    if (!settings.phoneNumber) throw new NoPhoneNumberError();
    await sendTestSmsReminder(settings.phoneNumber);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof SmsNotConfiguredError || err instanceof NoPhoneNumberError) {
      res.status(400).json({ error: "SMS_UNAVAILABLE", message: err.message });
      return;
    }
    next(err);
  }
});

export default router;
