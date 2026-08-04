"use client";

import { Clock3, Download, Eye, FileSpreadsheet, History, ShieldCheck, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

type BusinessCaseFile = {
  id: string;
  project_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
};

type SheetPreview = { name: string; rows: string[][] };

function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return new Intl.DateTimeFormat("es-CL").format(value);
  if (typeof value === "object") {
    const item = value as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (item.result !== undefined) return cellText(item.result);
    if (item.richText) return item.richText.map((part) => part.text).join("");
    if (item.text) return item.text;
  }
  return String(value);
}

export function ProjectBusinessCase({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<BusinessCaseFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewingId, setPreviewingId] = useState("");
  const [previewFileId, setPreviewFileId] = useState("");
  const [sheets, setSheets] = useState<SheetPreview[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);

  const loadFiles = useCallback(async () => {
    if (!hasSupabaseConfig) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: loadError } = await createClient()!
      .from("project_business_case_files")
      .select("id,project_id,storage_path,file_name,mime_type,file_size,uploaded_at")
      .eq("project_id", projectId)
      .order("uploaded_at", { ascending: false });
    if (loadError) {
      setError(loadError.code === "42P01"
        ? "Falta aplicar la migración 202607270026_project_impact_business_case.sql en Supabase."
        : loadError.message);
    } else {
      setFiles((data || []) as BusinessCaseFile[]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void loadFiles();
    const refresh = () => { void loadFiles(); };
    window.addEventListener("orbit:refresh-data", refresh);
    return () => window.removeEventListener("orbit:refresh-data", refresh);
  }, [loadFiles]);

  const getBlob = async (file: BusinessCaseFile) => {
    const { data, error: downloadError } = await createClient()!.storage
      .from("project-business-cases")
      .download(file.storage_path);
    if (downloadError || !data) throw new Error(downloadError?.message || "No se pudo descargar el archivo.");
    return data;
  };

  const downloadFile = async (file: BusinessCaseFile) => {
    setError("");
    try {
      const blob = await getBlob(file);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.file_name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "No se pudo descargar el archivo.");
    }
  };

  const preview = async (file: BusinessCaseFile) => {
    if (!file.file_name.toLowerCase().endsWith(".xlsx")) {
      setError("La previsualización está disponible para archivos .xlsx. Este archivo sí se puede descargar.");
      return;
    }
    setError("");
    setPreviewingId(file.id);
    try {
      const blob = await getBlob(file);
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await blob.arrayBuffer() as never);
      const nextSheets: SheetPreview[] = workbook.worksheets.slice(0, 12).map((sheet) => {
        const rows: string[][] = [];
        const lastRow = Math.min(sheet.actualRowCount || sheet.rowCount, 100);
        const lastColumn = Math.min(sheet.actualColumnCount || sheet.columnCount, 30);
        for (let rowIndex = 1; rowIndex <= lastRow; rowIndex += 1) {
          const row: string[] = [];
          for (let columnIndex = 1; columnIndex <= lastColumn; columnIndex += 1) {
            row.push(cellText(sheet.getCell(rowIndex, columnIndex).value));
          }
          rows.push(row);
        }
        return { name: sheet.name, rows };
      });
      setSheets(nextSheets);
      setActiveSheet(0);
      setPreviewFileId(file.id);
    } catch {
      setError("No pudimos interpretar este libro. Puedes descargar el original sin perder información.");
    }
    setPreviewingId("");
  };

  const uploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !hasSupabaseConfig) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "xlsx" && extension !== "xls") {
      setError("Selecciona un archivo Excel .xlsx o .xls.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("El archivo supera el límite de 25 MB.");
      return;
    }

    setBusy(true);
    setError("");
    const supabase = createClient()!;
    const { data: userResult } = await supabase.auth.getUser();
    const userId = userResult.user?.id;
    if (!userId) {
      setError("Debes iniciar sesión nuevamente.");
      setBusy(false);
      return;
    }
    const storagePath = `${projectId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("project-business-cases")
      .upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }
    const { error: metadataError } = await supabase.from("project_business_case_files").insert({
      project_id: projectId,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      file_size: file.size,
      uploaded_by: userId,
    });
    if (metadataError) {
      setError(metadataError.message);
      setBusy(false);
      return;
    }
    await loadFiles();
    setBusy(false);
  };

  const currentSheet = sheets[activeSheet];
  const latest = files[0];

  return <section className="business-case-view">
    <header className="business-case-hero">
      <span className="business-case-icon"><FileSpreadsheet /></span>
      <div><span className="eyebrow">RESPALDO DEL PROYECTO</span><h3>Caso de negocio</h3><p>Conserva el Excel original, compártelo con quienes pueden ver el proyecto y consulta sus versiones sin modificar el archivo.</p></div>
      {canEdit && <label className={`button primary business-case-upload ${busy ? "disabled" : ""}`}><Upload size={15} />{busy ? "Subiendo…" : latest ? "Subir nueva versión" : "Cargar Excel"}<input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={uploadFile} disabled={busy} /></label>}
    </header>

    <div className="business-case-assurance"><ShieldCheck size={15} /><span><b>Acceso protegido por proyecto.</b> Cualquier perfil con permiso de vista puede descargarlo. Las versiones anteriores no se eliminan al cargar una nueva.</span></div>
    {error && <p className="form-error business-case-error">{error}</p>}

    {loading ? <div className="view-empty"><FileSpreadsheet /><b>Cargando caso de negocio…</b></div> : !latest ? <div className="business-case-empty"><FileSpreadsheet size={28} /><b>Aún no hay un caso de negocio</b><span>{canEdit ? "Carga el Excel para dejarlo disponible en el proyecto." : "Un editor del proyecto puede cargar el documento."}</span></div> : <>
      <article className="business-case-current">
        <span className="business-case-file-mark"><FileSpreadsheet /></span>
        <div><small>VERSIÓN ACTUAL</small><b>{latest.file_name}</b><span>{readableSize(latest.file_size)} · {new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(latest.uploaded_at))}</span></div>
        <button className="button secondary" onClick={() => preview(latest)} disabled={previewingId === latest.id}><Eye size={15} />{previewingId === latest.id ? "Abriendo…" : "Previsualizar"}</button>
        <button className="button primary" onClick={() => downloadFile(latest)}><Download size={15} /> Descargar</button>
      </article>

      {previewFileId && currentSheet && <section className="business-case-preview">
        <header><div><span className="eyebrow">VISTA PREVIA</span><h4>{files.find((file) => file.id === previewFileId)?.file_name}</h4></div><span>Máximo 100 filas y 30 columnas por hoja</span></header>
        <nav>{sheets.map((sheet, index) => <button className={activeSheet === index ? "active" : ""} onClick={() => setActiveSheet(index)} key={`${sheet.name}-${index}`}>{sheet.name}</button>)}</nav>
        <div className="business-case-sheet"><table><tbody>{currentSheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td className={rowIndex === 0 ? "header-cell" : ""} key={columnIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
      </section>}

      {files.length > 1 && <section className="business-case-history">
        <header><History size={15} /><div><b>Versiones anteriores</b><small>Historial preservado del caso de negocio</small></div></header>
        {files.slice(1).map((file) => <article key={file.id}><FileSpreadsheet size={16} /><div><b>{file.file_name}</b><span><Clock3 size={11} /> {new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(file.uploaded_at))} · {readableSize(file.file_size)}</span></div><button onClick={() => preview(file)} title="Previsualizar"><Eye size={15} /></button><button onClick={() => downloadFile(file)} title="Descargar"><Download size={15} /></button></article>)}
      </section>}
    </>}
  </section>;
}
