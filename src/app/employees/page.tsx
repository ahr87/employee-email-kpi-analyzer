"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { errorMessage, useQuery } from "@/lib/client";
import { createEmployee, deleteEmployee, listEmployees, updateEmployee } from "@/lib/employees/service";
import { exportEmployeesCsv, exportEmployeesXlsx, importEmployees } from "@/lib/employees/import-export";
import { CSV_MIME, XLSX_MIME, downloadFile } from "@/lib/utils/download";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Spinner, Td, Th, useToast } from "@/components/ui";

interface Emp { id: string; employeeId: string; name: string; email: string; department: string; team: string; active: boolean }
const blank = { employeeId: "", name: "", email: "", department: "", team: "", active: true };

export default function EmployeesPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useQuery(`employees:${q}`, () => listEmployees(q));
  const [edit, setEdit] = useState<(Partial<Emp> & typeof blank) | null>(null);
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function save() {
    if (!edit) return;
    setSaving(true);
    try {
      const { id, ...body } = edit as Emp;
      if (id) await updateEmployee(id, body); else await createEmployee(body);
      toast("ok", "Employee saved."); setEdit(null); reload();
    } catch (e) { toast("error", errorMessage(e)); } finally { setSaving(false); }
  }
  async function toggle(e: Emp) {
    try { await updateEmployee(e.id, { active: !e.active }); reload(); } catch (x) { toast("error", errorMessage(x)); }
  }
  async function del(e: Emp) {
    if (!confirm(`Delete ${e.name}? Their emails are kept but become "unmatched".`)) return;
    try { await deleteEmployee(e.id); toast("ok", "Employee deleted."); reload(); } catch (x) { toast("error", errorMessage(x)); }
  }
  async function upload(f: File) {
    try {
      if (!/\.(csv|xlsx)$/i.test(f.name)) throw new Error("Only .csv and .xlsx files are supported.");
      if (f.size > 10 * 1024 * 1024) throw new Error("The file is too large (limit 10 MB).");
      const r = await importEmployees(f.name, await f.arrayBuffer());
      toast(r.errors.length ? "error" : "ok", `Imported: ${r.created} created, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} error(s): ${r.errors.slice(0, 2).join(" | ")}` : ""}`);
      reload();
    } catch (x) { toast("error", errorMessage(x)); }
    if (file.current) file.current.value = "";
  }
  async function exportAs(kind: "xlsx" | "csv") {
    try {
      if (kind === "xlsx") downloadFile("employees.xlsx", await exportEmployeesXlsx(), XLSX_MIME);
      else downloadFile("employees.csv", await exportEmployeesCsv(), CSV_MIME);
    } catch (x) { toast("error", errorMessage(x)); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Employees</h1><p className="text-sm text-slate-500">The sender e-mail address is matched against this list. Email addresses must be unique.</p></div>
        <div className="flex flex-wrap gap-2">
          <input ref={file} type="file" accept=".csv,.xlsx" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="secondary" onClick={() => file.current?.click()}><Upload className="h-4 w-4" />Import CSV / Excel</Button>
          <Button variant="secondary" onClick={() => exportAs("xlsx")}><Download className="h-4 w-4" />Excel</Button>
          <Button variant="secondary" onClick={() => exportAs("csv")}><Download className="h-4 w-4" />CSV</Button>
          <Button onClick={() => setEdit({ ...blank })}><Plus className="h-4 w-4" />Add employee</Button>
        </div>
      </div>
      <Input placeholder="Search by name, email, ID, department, team…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
      <Card>
        {loading && !data ? <Spinner /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
          <EmptyState title="No employees yet" hint="Add employees manually or import a CSV/Excel file with the columns: Employee ID, Employee Name, Email Address, Department, Team, Active. A sample file is in sample-data/employees.csv." />
        ) : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><Th>ID</Th><Th>Name</Th><Th>Email</Th><Th>Department</Th><Th>Team</Th><Th>Status</Th><Th> </Th></tr></thead>
            <tbody>{data.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <Td>{e.employeeId}</Td><Td><Link href={`/employee?id=${e.id}`} className="font-medium text-blue-700 hover:underline">{e.name}</Link></Td><Td>{e.email}</Td><Td>{e.department}</Td><Td>{e.team}</Td>
                <Td><button onClick={() => toggle(e)} title="Click to toggle"><Badge className={e.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}>{e.active ? "Active" : "Inactive"}</Badge></button></Td>
                <Td className="whitespace-nowrap"><Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEdit({ ...e })}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="sm" aria-label="Delete" onClick={() => del(e)}><Trash2 className="h-4 w-4" /></Button></Td>
              </tr>))}</tbody></table></div>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={(edit as Emp | null)?.id ? "Edit employee" : "Add employee"}>
        {edit && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee ID"><Input required value={edit.employeeId} onChange={(e) => setEdit({ ...edit, employeeId: e.target.value })} /></Field>
              <Field label="Employee name"><Input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            </div>
            <Field label="Email address (matching key)"><Input required type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Department"><Input value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></Field>
              <Field label="Team"><Input value={edit.team} onChange={(e) => setEdit({ ...edit, team: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
