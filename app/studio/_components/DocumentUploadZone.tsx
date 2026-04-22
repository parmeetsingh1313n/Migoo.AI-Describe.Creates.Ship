"use client"
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, ChevronDown, FileText, Globe, Loader2, Upload, X, Zap, Image as ImageIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import Image from 'next/image'

const SUPPORTED_LANGUAGES = [
    { code: "en-IN", name: "English",   native: "English"    },
    { code: "hi-IN", name: "Hindi",     native: "हिन्दी"    },
    { code: "bn-IN", name: "Bengali",   native: "বাংলা"      },
    { code: "gu-IN", name: "Gujarati",  native: "ગુજરાતી"   },
    { code: "kn-IN", name: "Kannada",   native: "ಕನ್ನಡ"     },
    { code: "ml-IN", name: "Malayalam", native: "മലയാളം"    },
    { code: "mr-IN", name: "Marathi",   native: "मराठी"     },
    { code: "or-IN", name: "Odia",      native: "ଓଡ଼ିଆ"     },
    { code: "pa-IN", name: "Punjabi",   native: "ਪੰਜਾਬੀ"    },
    { code: "ta-IN", name: "Tamil",     native: "தமிழ்"     },
    { code: "te-IN", name: "Telugu",    native: "తెలుగు"    },
    { code: "ur-IN", name: "Urdu",      native: "اردو"      },
]

type ProcessState = "idle" | "creating" | "uploading" | "processing" | "done" | "error"

interface ExtractedResult { markdown: string; images: string[] }
interface Props { onResult: (result: ExtractedResult) => void }

interface NativeImage {
    id: string;
    file: File;
    url?: string;
    uploading: boolean;
}

export default function DocumentUploadZone({ onResult }: Props) {
    const [docFile, setDocFile]         = useState<File | null>(null)
    const [nativeImages, setNativeImages] = useState<NativeImage[]>([])
    const [docLang, setDocLang]         = useState("en-IN")
    const [state, setState]             = useState<ProcessState>("idle")
    const [result, setResult]           = useState<ExtractedResult>({ markdown: "", images: [] })
    const [showPreview, setShowPreview] = useState(false)
    const [dragOver, setDragOver]       = useState(false)
    const fileRef  = useRef<HTMLInputElement>(null)
    const pollRef  = useRef<NodeJS.Timeout | null>(null)

    // Helper to send the unified result
    const emitResult = (r: ExtractedResult) => {
        setResult(r)
        onResult(r)
    }

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return

        const fileArray = Array.from(files)
        const pdfOrZip = fileArray.find(f => f.name.endsWith(".pdf") || f.name.endsWith(".zip"))
        const stdImages = fileArray.filter(f => f.type.startsWith("image/"))

        // Add document if found and not already set
        if (pdfOrZip) {
            setDocFile(pdfOrZip)
        }

        // Process native images immediately
        if (stdImages.length > 0) {
            const newImages: NativeImage[] = stdImages.map(img => ({
                id: Math.random().toString(36).slice(2, 9),
                file: img,
                uploading: true
            }))

            setNativeImages(prev => [...prev, ...newImages])

            for (const item of newImages) {
                try {
                    const formData = new FormData()
                    formData.append("file", item.file)
                    const res = await fetch("/api/upload-image", { method: "POST", body: formData })
                    const data = await res.json()
                    
                    if (data.url) {
                        setNativeImages(prev => prev.map(p => p.id === item.id ? { ...p, url: data.url, uploading: false } : p))
                        // Update master result images array
                        emitResult({
                            markdown: result.markdown,
                            images: [...result.images, data.url]
                        })
                        toast.success(`Uploaded ${item.file.name}`)
                    } else {
                        throw new Error(data.error || "Failed")
                    }
                } catch (e: any) {
                    toast.error(`Failed to upload ${item.file.name}: ${e.message}`)
                    setNativeImages(prev => prev.filter(p => p.id !== item.id))
                }
            }
        }
    }

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
    }, [result])

    const processDocument = async () => {
        if (!docFile) return
        setState("creating")
        try {
            const createRes  = await fetch("/api/sarvam-doc", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "create-job", language: docLang, format: "md" }),
            })
            const createData = await createRes.json()
            if (!createRes.ok) throw new Error(createData.error || "Failed to create job")
            const newJobId: string = createData.job_id

            setState("uploading")
            const fileData  = await fileToBase64(docFile)
            const uploadRes = await fetch("/api/sarvam-doc", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "upload", job_id: newJobId, fileName: docFile.name, fileData }),
            })
            if (!uploadRes.ok) throw new Error((await uploadRes.json()).error || "Upload failed")

            setState("processing")
            await fetch("/api/sarvam-doc", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start", job_id: newJobId }),
            })
            pollJob(newJobId)
        } catch (err: any) {
            toast.error(err.message || "Document processing failed")
            setState("error")
        }
    }

    const pollJob = (jid: string) => {
        let attempts = 0
        pollRef.current = setInterval(async () => {
            if (++attempts > 60) {
                clearInterval(pollRef.current!); setState("error")
                toast.error("Document processing timed out"); return
            }
            try {
                const res  = await fetch(`/api/sarvam-doc?action=status&job_id=${jid}`)
                const data = await res.json()
                if (data.state === "Completed" || data.state === "PartiallyCompleted") {
                    clearInterval(pollRef.current!)
                    // Merge doc extracted data with existing user native uploads
                    const r: ExtractedResult = { markdown: data.markdown || "", images: [...result.images, ...(data.images || [])] }
                    emitResult(r); setState("done")
                    toast.success("Document extracted successfully!")
                } else if (data.state === "Failed") {
                    clearInterval(pollRef.current!); setState("error")
                    toast.error("Document parsing failed")
                }
            } catch { /* continue polling */ }
        }, 5000)
    }

    const removeNativeImage = (id: string, url?: string) => {
        setNativeImages(prev => prev.filter(img => img.id !== id))
        if (url) {
            emitResult({
                markdown: result.markdown,
                images: result.images.filter(i => i !== url)
            })
        }
    }

    const resetDoc = () => {
        if (pollRef.current) clearInterval(pollRef.current)
        setDocFile(null); emitResult({ markdown: "", images: result.images }); setState("idle")
    }

    const stateLabel: Record<ProcessState, string> = {
        idle: "", creating: "Preparing document…", uploading: "Uploading to Migoo AI…",
        processing: "Migoo AI is reading your document…", done: "Extraction complete!", error: "Something went wrong",
    }

    return (
        <div className="space-y-4">
            {/* Language label */}
            <div className="flex items-center gap-2 mb-1">
                <Globe className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Document Source Language</span>
            </div>

            {/* Language grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mb-3">
                {SUPPORTED_LANGUAGES.map(lang => (
                    <button
                        key={lang.code}
                        onClick={() => setDocLang(lang.code)}
                        className={`px-2 py-2 rounded-xl text-center text-xs font-medium transition-all border cursor-pointer ${
                            docLang === lang.code
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/70'
                        }`}
                    >
                        <div className="font-bold text-[11px]">{lang.native}</div>
                        <div className="text-[9px] opacity-60 mt-0.5">{lang.name}</div>
                    </button>
                ))}
            </div>

            {/* Upload Zone */}
            <AnimatePresence mode="wait">
                {state === "idle" && (
                    <motion.div
                        key="dropzone"
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => fileRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300 ${
                            dragOver
                                ? 'border-primary/50 bg-primary/5 scale-[1.01]'
                                : docFile
                                    ? 'border-border/60 bg-white shadow-sm'
                                    : 'border-border hover:border-border/80 hover:bg-muted/10 bg-muted/5'
                        }`}
                    >
                        <input
                            ref={fileRef} type="file" className="hidden" accept=".pdf,.zip,image/*" multiple
                            onChange={e => handleFiles(e.target.files)}
                        />
                        {docFile ? (
                            <div className="flex items-center justify-center gap-3">
                                <FileText className="w-8 h-8 text-primary shrink-0" />
                                <div className="text-left">
                                    <p className="text-sm font-semibold text-foreground">{docFile.name}</p>
                                    <p className="text-xs text-muted-foreground">{(docFile.size / 1024 / 1024).toFixed(1)} MB</p>
                                </div>
                                <button
                                    onClick={e => { e.stopPropagation(); resetDoc() }}
                                    className="ml-auto w-7 h-7 rounded-lg bg-muted flex items-center justify-center hover:bg-destructive/10 transition-colors"
                                >
                                    <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                                </button>
                            </div>
                        ) : (
                            <>
                                <Upload className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                                <p className="text-sm font-medium text-muted-foreground">Drop PDF, ZIP, or Images here</p>
                                <p className="text-xs text-muted-foreground/60 mt-1">Images upload instantly · PDF max 200 MB</p>
                            </>
                        )}
                    </motion.div>
                )}

                {/* Processing States */}
                {(state === "creating" || state === "uploading" || state === "processing") && (
                    <motion.div
                        key="processing"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl border border-border bg-white p-6 text-center shadow-sm"
                    >
                        <div className="flex items-center justify-center gap-3 mb-4">
                            <Loader2 className="w-6 h-6 text-primary animate-spin" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">{stateLabel[state]}</p>
                        {state === "processing" && (
                            <p className="text-xs text-muted-foreground mt-1">Parsing detailed structural data (30-60s)</p>
                        )}
                    </motion.div>
                )}

                {/* PDF Extraction Done State */}
                {state === "done" && result.markdown && (
                    <motion.div
                        key="done"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="rounded-xl border border-border bg-white shadow-sm p-4"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                <span className="text-sm font-semibold text-foreground">Document extracted!</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowPreview(v => !v)}
                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    Data Preview <ChevronDown className={`w-3 h-3 transition-transform ${showPreview ? 'rotate-180' : ''}`} />
                                </button>
                                <button onClick={resetDoc} className="text-[11px] text-destructive hover:underline transition-colors">
                                    Remove Doc
                                </button>
                            </div>
                        </div>

                        <AnimatePresence>
                            {showPreview && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    <pre className="text-xs text-muted-foreground bg-muted/40 border border-border/40 rounded-xl p-4 overflow-y-auto max-h-48 font-mono leading-relaxed whitespace-pre-wrap break-words">
                                        {result.markdown.slice(0, 1200)}{result.markdown.length > 1200 ? "\n\n… (truncated)" : ""}
                                    </pre>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}

                {state === "error" && (
                    <motion.div
                        key="error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 flex items-center gap-3"
                    >
                        <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-destructive">Processing failed</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Check your file format and try again</p>
                        </div>
                        <button onClick={resetDoc} className="text-xs text-destructive hover:underline cursor-pointer">Retry Doc</button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Render uploaded native images */}
            {nativeImages.length > 0 && (
                <div className="mt-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                        Uploaded Images ({nativeImages.length})
                    </p>
                    <div className="flex flex-wrap gap-3">
                        {nativeImages.map((img) => (
                            <div key={img.id} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border shadow-sm group bg-muted flex items-center justify-center">
                                {img.uploading ? (
                                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                                ) : img.url ? (
                                    <Image src={img.url} alt="upload" fill className="object-cover" />
                                ) : (
                                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                                )}
                                
                                {/* Overlay remove button */}
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <button
                                        onClick={() => removeNativeImage(img.id, img.url)}
                                        className="w-7 h-7 bg-white/20 hover:bg-destructive/80 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Process document button */}
            {state === "idle" && docFile && (
                <motion.button
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={processDocument}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 hover:shadow-md transition-all duration-200 cursor-pointer"
                >
                    <Zap className="w-4 h-4" />
                    Extract Document Data
                </motion.button>
            )}
        </div>
    )
}

async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve((reader.result as string).split(",")[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}
