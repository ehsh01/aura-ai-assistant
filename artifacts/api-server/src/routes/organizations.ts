import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createOrganizationForUser,
  deleteOrganizationForUser,
  getOrganizationForUser,
  listOrganizationsForUser,
  updateOrganizationForUser,
} from "../services/organizations";
import {
  createInvoiceForUser,
  deleteInvoiceForUser,
  getInvoiceForUser,
  listInvoicesForUser,
  updateInvoiceForUser,
} from "../services/invoices";
import { listOrganizationPeople } from "../services/person-org";

const CreateOrganizationBody = z.object({
  displayName: z.string().min(1).max(255),
  orgType: z.enum(["vendor", "contractor", "employer", "agency", "other"]).optional(),
  email: z.string().max(255).nullish(),
  phone: z.string().max(64).nullish(),
  website: z.string().max(500).nullish(),
  notes: z.string().max(5000).nullish(),
});

const UpdateOrganizationBody = CreateOrganizationBody.partial();

const CreateInvoiceBody = z.object({
  title: z.string().min(1).max(500),
  organizationId: z.string().max(64).nullish(),
  amountCents: z.number().int().nullish(),
  currency: z.string().max(8).nullish(),
  status: z.enum(["open", "paid", "void", "other"]).optional(),
  invoiceDate: z.string().max(10).nullish(),
  dueDate: z.string().max(10).nullish(),
  notes: z.string().max(5000).nullish(),
});

const UpdateInvoiceBody = CreateInvoiceBody.partial();

const router: IRouter = Router();
router.use(requireAuth);

router.get("/organizations", async (req, res, next) => {
  try {
    const organizations = await listOrganizationsForUser(req.user!.id);
    res.json({ organizations });
  } catch (err) {
    next(err);
  }
});

router.post("/organizations", async (req, res, next) => {
  try {
    const body = CreateOrganizationBody.parse(req.body);
    const organization = await createOrganizationForUser(req.user!.id, body);
    res.status(201).json(organization);
  } catch (err) {
    next(err);
  }
});

router.get("/organizations/:organizationId", async (req, res, next) => {
  try {
    const organization = await getOrganizationForUser(
      req.user!.id,
      req.params.organizationId,
    );
    if (!organization) {
      res.status(404).json({ error: "NOT_FOUND", message: "Organization not found" });
      return;
    }
    res.json(organization);
  } catch (err) {
    next(err);
  }
});

router.get("/organizations/:organizationId/people", async (req, res, next) => {
  try {
    const organization = await getOrganizationForUser(
      req.user!.id,
      req.params.organizationId,
    );
    if (!organization) {
      res.status(404).json({ error: "NOT_FOUND", message: "Organization not found" });
      return;
    }
    const people = await listOrganizationPeople(req.user!.id, req.params.organizationId);
    res.json({ people });
  } catch (err) {
    next(err);
  }
});

router.patch("/organizations/:organizationId", async (req, res, next) => {
  try {
    const body = UpdateOrganizationBody.parse(req.body);
    const organization = await updateOrganizationForUser(
      req.user!.id,
      req.params.organizationId,
      body,
    );
    if (!organization) {
      res.status(404).json({ error: "NOT_FOUND", message: "Organization not found" });
      return;
    }
    res.json(organization);
  } catch (err) {
    next(err);
  }
});

router.delete("/organizations/:organizationId", async (req, res, next) => {
  try {
    const ok = await deleteOrganizationForUser(req.user!.id, req.params.organizationId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Organization not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get("/invoices", async (req, res, next) => {
  try {
    const invoices = await listInvoicesForUser(req.user!.id);
    res.json({ invoices });
  } catch (err) {
    next(err);
  }
});

router.post("/invoices", async (req, res, next) => {
  try {
    const body = CreateInvoiceBody.parse(req.body);
    const invoice = await createInvoiceForUser(req.user!.id, body);
    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
});

router.get("/invoices/:invoiceId", async (req, res, next) => {
  try {
    const invoice = await getInvoiceForUser(req.user!.id, req.params.invoiceId);
    if (!invoice) {
      res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found" });
      return;
    }
    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

router.patch("/invoices/:invoiceId", async (req, res, next) => {
  try {
    const body = UpdateInvoiceBody.parse(req.body);
    const invoice = await updateInvoiceForUser(req.user!.id, req.params.invoiceId, body);
    if (!invoice) {
      res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found" });
      return;
    }
    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

router.delete("/invoices/:invoiceId", async (req, res, next) => {
  try {
    const ok = await deleteInvoiceForUser(req.user!.id, req.params.invoiceId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
