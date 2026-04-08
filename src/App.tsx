/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs, User, Timestamp, serverTimestamp, arrayUnion, deleteField 
} from './firebase';
import { 
  format, addMinutes, parseISO, isSameDay, startOfDay, endOfDay, isWithinInterval,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, addMonths
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  Calendar, Users, MessageSquare, Mic, MicOff, LogOut, Plus, Trash2, 
  CheckCircle, XCircle, Clock, Phone, Mail, Send, Menu, X, ChevronRight, ChevronLeft,
  CalendarDays, UserPlus, History, Settings, HelpCircle, Sparkles, Search, ExternalLink,
  Paperclip, FileText, ChevronsLeft, ChevronsRight, Link as LinkIcon, Copy, Check, Calendar as CalendarIcon,
  CheckCircle2, AlertCircle, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utility ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const cleanPhone = (phone: string) => {
  return phone.replace(/\D/g, '');
};

const formatPhone = (phone: string) => {
  const digits = cleanPhone(phone);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

const playSound = (type: 'start' | 'end' | 'active' | 'success') => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  const now = ctx.currentTime;
  
  if (type === 'start') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'end') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.15);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'active') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
    
    const osc2 = ctx.createOscillator();
    osc2.connect(gain);
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.1);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.2);
  } else if (type === 'success') {
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.setValueAtTime(freq, now + i * 0.1);
      g.gain.setValueAtTime(0.1, now + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      o.start(now + i * 0.1);
      o.stop(now + i * 0.1 + 0.2);
    });
  }
};

const speak = (text: string, onEnd?: () => void, cancel = false) => {
  if (!('speechSynthesis' in window)) return;
  if (cancel) window.speechSynthesis.cancel();
  
  // Clean text: remove markdown elements but KEEP punctuation for intonation
  // Also remove common symbols that might be read literally
  const cleanText = text
    .replace(/\*+/g, '') 
    .replace(/#+/g, '')  
    .replace(/_{2,}/g, '') 
    .replace(/[`]/g, '') 
    .replace(/\[.*\]\(.*\)/g, '') 
    .replace(/\{.*\}/s, '') 
    .replace(/[<>]/g, '')
    .trim();

  if (!cleanText) {
    if (onEnd) onEnd();
    return;
  }

  console.log("Speaking:", cleanText);

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'pt-BR';
  utterance.rate = 1.2; 
  utterance.pitch = 1.1; 

  const setVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => 
      v.lang.includes('pt-BR') && 
      (v.name.toLowerCase().includes('female') || 
       v.name.toLowerCase().includes('mulher') || 
       v.name.toLowerCase().includes('maria') || 
       v.name.toLowerCase().includes('luciana') ||
       v.name.toLowerCase().includes('google português do brasil') ||
       v.name.toLowerCase().includes('francisca') ||
       v.name.toLowerCase().includes('vitoria') ||
       v.name.toLowerCase().includes('helena'))
    );
    if (femaleVoice) utterance.voice = femaleVoice;
    
    utterance.onend = () => {
      if (onEnd) onEnd();
    };
    
    utterance.onerror = (e) => {
      console.error("Speech error:", e);
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterance);
  };

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = setVoice;
  } else {
    setVoice();
  }
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; errorInfo: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: '' };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-6 text-center">
          <Card className="max-w-md w-full p-8 space-y-4 border-red-100">
            <XCircle className="text-red-500 w-16 h-16 mx-auto" />
            <h2 className="text-2xl font-bold text-red-900">Ops! Algo deu errado.</h2>
            <p className="text-red-600 text-sm">Ocorreu um erro inesperado no sistema.</p>
            <div className="bg-red-100 p-4 rounded-xl text-left overflow-auto max-h-40">
              <code className="text-xs text-red-800">{this.state.errorInfo}</code>
            </div>
            <Button onClick={() => window.location.reload()} className="w-full bg-red-500 hover:bg-red-600">
              Recarregar Página
            </Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Types ---
type VoiceState = 'idle' | 'escutando' | 'capturando_fala' | 'aguardando_silencio' | 'processando' | 'responding';

interface Prontuario {
  texto: string;
  data: string;
  hora: string;
}

interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  userId: string;
  prontuarios: Prontuario[];
}

interface Appointment {
  id: string;
  clientName: string;
  clientPhone: string;
  clientId?: string;
  serviceName: string;
  servico_nome?: string;
  servico_duracao?: string;
  servico_tipo?: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  date: string;      // YYYY-MM-DD
  status: 'scheduled' | 'cancelled';
  userId: string;
  timestamp?: any;
}

interface ServiceHistory {
  id: string;
  clientId: string;
  clientName: string;
  date: string;
  startTime: string;
  serviceName: string;
  duration: string;
  type?: string;
  userId: string;
  timestamp: any;
}

interface BookingConfig {
  id?: string;
  userId: string;
  workingDays: number[]; // 0-6 (Sunday-Saturday)
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  breakStart?: string; // HH:MM
  breakEnd?: string; // HH:MM
  slotInterval: number; // 15, 30, 45, 60 minutes
  services: { name: string; duration: number; description?: string }[];
  initialMessage?: string;
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'iara';
  timestamp: Date;
  archived?: boolean;
}

interface Slot {
  id: string;
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  appointmentId?: string;
}

// --- Context ---
const AuthContext = createContext<{ user: User | null; loading: boolean }>({ user: null, loading: true });

const useAuth = () => useContext(AuthContext);

const AUTHORIZED_EMAIL = 'vitor.cd.1997@gmail.com';

const getPath = (userId: string, collectionName: string) => {
  const mapping: Record<string, string> = {
    'clients': 'clientes',
    'appointments': 'agenda',
    'messages': 'messages',
    'slots': 'slots',
    'bookingConfigs': 'config',
    'serviceHistory': 'history'
  };
  const name = mapping[collectionName] || collectionName;
  return `users/${userId}/${name}`;
};

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' }) => {
  const variants = {
    primary: 'bg-sky-500 text-white hover:bg-sky-600 shadow-md',
    secondary: 'bg-white text-sky-600 hover:bg-sky-50 shadow-sm',
    outline: 'border-2 border-sky-500 text-sky-600 hover:bg-sky-50',
    ghost: 'text-sky-600 hover:bg-sky-50',
    danger: 'bg-red-500 text-white hover:bg-red-600 shadow-md',
  };
  return (
    <button 
      className={cn('px-4 py-2 rounded-xl font-medium transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50', variants[variant], className)} 
      {...props} 
    />
  );
};

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('bg-white rounded-2xl shadow-sm border border-sky-100 p-4', className)}>
    {children}
  </div>
);

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        >
          <div className="p-6 border-b border-sky-50 flex justify-between items-center bg-sky-50/50 shrink-0">
            <h3 className="text-xl font-bold text-sky-900">{title}</h3>
            <button onClick={onClose} className="p-2 hover:bg-sky-100 rounded-full text-sky-600 transition-colors">
              <X size={20} />
            </button>
          </div>
          {children}
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

const ModalContent = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("flex-1 overflow-y-auto p-6 pr-8", className)}>
    {children}
  </div>
);

const ModalFooter = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("p-6 border-t border-sky-50 bg-sky-50/50 shrink-0", className)}>
    {children}
  </div>
);

// --- Hooks ---

function useIaraAI(clients: Client[], appointments: Appointment[]) {
  const { user } = useAuth();
  const [isTyping, setIsTyping] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, getPath(user.uid, 'messages')), 
      where('archived', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs
        .map(d => ({ sender: d.data().sender, text: d.data().text, timestamp: d.data().timestamp }))
        .sort((a, b) => a.timestamp.seconds - b.timestamp.seconds);
      
      const geminiHistory = msgs.map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));
      setHistory(geminiHistory);
    });
    return unsub;
  }, [user]);

  const processAction = async (action: any) => {
    if (!user) return;
    
    // FORCE FRESH DATA READING FOR ACTION EXECUTION
    const appsSnap = await getDocs(query(collection(db, getPath(user.uid, 'appointments'))));
    const freshApps = appsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Appointment));
    const clientsSnap = await getDocs(query(collection(db, getPath(user.uid, 'clients'))));
    const freshClients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client));

    const path = (action.acao === 'agendar' || action.acao === 'cancelar') ? getPath(user.uid, 'appointments') : getPath(user.uid, 'clients');
    try {
      switch (action.acao) {
        case 'agendar':
          if (!action.nome || !action.inicio || !action.fim) {
            console.warn('AI action missing required fields for agendar:', action);
            return;
          }
          
          // Check for conflicts
          const date = action.data || format(new Date(), 'yyyy-MM-dd');
          const hasConflict = freshApps.some(app => 
            app.date === date && 
            app.status === 'scheduled' &&
            ((action.inicio >= app.startTime && action.inicio < app.endTime) ||
             (action.fim > app.startTime && action.fim <= app.endTime) ||
             (action.inicio <= app.startTime && action.fim >= app.endTime))
          );

          if (hasConflict) {
            return "CONFLITO";
          }

          const client = freshClients.find(c => c.name.toLowerCase() === action.nome.toLowerCase());
          const clientPhone = client ? client.phone : "Não informado";
          
          // Calculate duration
          const start = parseISO(`${date}T${action.inicio}`);
          const end = parseISO(`${date}T${action.fim}`);
          const durationMin = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
          const durationStr = `${durationMin}min`;
          const baseServiceName = action.servico || "Atendimento";
          const serviceType = action.tipo;
          const serviceName = serviceType ? `${baseServiceName} (${serviceType})` : baseServiceName;

          const appData = {
            clientName: action.nome,
            clientPhone: clientPhone,
            clientId: client?.id,
            serviceName: serviceName,
            servico_nome: serviceName,
            servico_duracao: durationStr,
            startTime: action.inicio,
            endTime: action.fim,
            date: date,
            status: 'scheduled',
            userId: user.uid,
            timestamp: serverTimestamp()
          };

          const appRef = await addDoc(collection(db, getPath(user.uid, 'appointments')), appData);

          // Create history entry automatically
          if (client?.id) {
            await addDoc(collection(db, getPath(user.uid, 'serviceHistory')), {
              clientId: client.id,
              clientName: client.name,
              date: date,
              startTime: action.inicio,
              serviceName: serviceName,
              duration: durationStr,
              userId: user.uid,
              timestamp: serverTimestamp()
            });
          }

          // Create slot
          await addDoc(collection(db, getPath(user.uid, 'slots')), {
            userId: user.uid,
            date: date,
            startTime: action.inicio,
            endTime: action.fim,
            appointmentId: appRef.id
          });
          break;
        case 'cadastrar':
          if (!action.nome || !action.telefone) {
            console.warn('AI action missing required fields for cadastrar:', action);
            return "FALHA";
          }
          const cleanedPhone = cleanPhone(action.telefone);
          const existingClient = freshClients.find(c => 
            c.name.toLowerCase() === action.nome.toLowerCase() || 
            cleanPhone(c.phone) === cleanedPhone
          );
          
          if (existingClient) {
            return "JÁ EXISTE";
          }

          const newClientRef = await addDoc(collection(db, getPath(user.uid, 'clients')), {
            name: action.nome,
            phone: cleanedPhone,
            userId: user.uid,
            ...(action.email ? { email: action.email } : {}),
            prontuarios: [],
            timestamp: serverTimestamp()
          });

          // Validation: check if it was really saved
          const savedDoc = await getDoc(newClientRef);
          if (savedDoc.exists()) {
            return "SUCESSO";
          } else {
            return "FALHA";
          }
        case 'cadastrar_nota':
          if (!action.nome || !action.texto) {
            console.warn('AI action missing required fields for cadastrar_nota:', action);
            return "FALHA";
          }
          const targetClient = freshClients.find(c => c.name.toLowerCase().includes(action.nome.toLowerCase()));
          if (targetClient) {
            const now = new Date();
            const newNote = {
              texto: action.texto,
              data: format(now, 'dd/MM/yyyy'),
              hora: format(now, 'HH:mm')
            };

            await updateDoc(doc(db, getPath(user.uid, 'clients'), targetClient.id), {
              prontuarios: arrayUnion(newNote)
            });
            
            // Validation: check if it was really saved
            const savedDoc = await getDoc(doc(db, getPath(user.uid, 'clients'), targetClient.id));
            const data = savedDoc.data();
            if (data && data.prontuarios && Array.isArray(data.prontuarios)) {
              const found = data.prontuarios.some((p: any) => p.texto === newNote.texto && p.data === newNote.data && p.hora === newNote.hora);
              if (found) return "SUCESSO";
            }
            return "FALHA";
          } else {
            return "NÃO ENCONTRADO";
          }
        case 'atualizar_cliente':
          if (!action.nome) {
            console.warn('AI action missing required fields for atualizar_cliente:', action);
            return "FALHA";
          }
          const clientToUpdate = freshClients.find(c => c.name.toLowerCase().includes(action.nome.toLowerCase()));
          if (clientToUpdate) {
            const updateData: any = {};
            if (action.telefone) updateData.phone = cleanPhone(action.telefone);
            if (action.email) updateData.email = action.email;
            
            await updateDoc(doc(db, getPath(user.uid, 'clients'), clientToUpdate.id), updateData);
            
            // Validation: check if it was really updated
            const updatedDoc = await getDoc(doc(db, getPath(user.uid, 'clients'), clientToUpdate.id));
            const data = updatedDoc.data();
            if (data && 
                (!action.telefone || data.phone === cleanPhone(action.telefone)) && 
                (!action.email || data.email === action.email)) {
              return "SUCESSO";
            } else {
              return "FALHA";
            }
          } else {
            return "NÃO ENCONTRADO";
          }
        case 'cancelar':
          let toCancel;
          const cancelDate = action.data || format(new Date(), 'yyyy-MM-dd');
          
          if (action.id) {
            toCancel = freshApps.find(a => a.id === action.id);
          } else if (action.nome) {
            toCancel = freshApps.find(a => 
              a.clientName.toLowerCase().includes(action.nome.toLowerCase()) && 
              a.status === 'scheduled' &&
              a.date === cancelDate
            ) || freshApps.find(a => 
              a.clientName.toLowerCase().includes(action.nome.toLowerCase()) && 
              a.status === 'scheduled'
            );
          } else if (action.horario) {
             toCancel = freshApps.find(a => 
              a.startTime === action.horario && 
              a.status === 'scheduled' &&
              a.date === cancelDate
            ) || freshApps.find(a => 
              a.startTime === action.horario && 
              a.status === 'scheduled'
            );
          }

          if (toCancel) {
            await deleteDoc(doc(db, getPath(user.uid, 'appointments'), toCancel.id));
            // Delete corresponding slot
            const slotsSnap = await getDocs(query(collection(db, getPath(user.uid, 'slots')), where('appointmentId', '==', toCancel.id)));
            for (const slotDoc of slotsSnap.docs) {
              await deleteDoc(doc(db, getPath(user.uid, 'slots'), slotDoc.id));
            }
            return "SUCESSO";
          } else {
            return "NÃO ENCONTRADO";
          }
          break;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const isProcessingRef = useRef(false);

  const handleSend = async (
    text: string, 
    onResponse?: (aiText: string, onEnd?: () => void) => void,
    onSpeechEnd?: (fullText: string) => void
  ): Promise<string> => {
    if (!text.trim() || !user || isProcessingRef.current) return "";
    
    isProcessingRef.current = true;
    setIsTyping(true);
    const path = getPath(user.uid, 'messages');
    const userMsg = { text, sender: 'user' as const, timestamp: new Date(), userId: user.uid, archived: false };
    try {
      await addDoc(collection(db, path), userMsg);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
    
    let fullText = "";
    try {
      // FORCE FRESH DATA READING FROM FIRESTORE
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const clientsSnap = await getDocs(query(collection(db, getPath(user.uid, 'clients'))));
      const appsSnap = await getDocs(query(collection(db, getPath(user.uid, 'appointments'))));
      
      const freshClients = clientsSnap.docs.map(d => {
        const clientData = d.data();
        return { 
          id: d.id,
          name: clientData.name, 
          phone: formatPhone(clientData.phone),
          prontuarios: clientData.prontuarios || []
        };
      });
      const freshApps = appsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Appointment))
        .filter(a => a.status === 'scheduled' && a.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        config: {
          systemInstruction: `Você é TRIAS, uma assistente virtual inteligente para massagistas e barbearias.
          Seu objetivo é ajudar a gerenciar agenda e clientes com precisão absoluta.
          
          DATA ATUAL DO SISTEMA (REFERÊNCIA ABSOLUTA): ${format(new Date(), "dd/MM/yyyy (EEEE)", { locale: ptBR })}
          
          FONTE ÚNICA DE VERDADE (DADOS REAIS DO SISTEMA AGORA):
          - Clientes: ${JSON.stringify(freshClients)}
          - Agenda (Próximos dias): ${JSON.stringify(freshApps)}
          
          REGRAS CRÍTICAS DE SINCRONIZAÇÃO:
          1. O histórico de conversa pode conter informações DESATUALIZADAS (ex: agendamentos que foram cancelados ou alterados manualmente).
          2. IGNORE qualquer informação de agendamento vinda do histórico que não esteja na lista de "FONTE ÚNICA DE VERDADE" acima.
          3. Se o usuário perguntar sobre um agendamento que NÃO está nos dados acima, diga que ele não existe ou foi removido.
          4. Antes de confirmar qualquer ação, verifique os dados reais acima.
          5. USE A "DATA ATUAL DO SISTEMA" ACIMA PARA CALCULAR DATAS RELATIVAS (ex: "hoje", "amanhã", "depois de amanhã"). NUNCA use datas de 2024 ou qualquer outra data que não seja baseada na referência fornecida.
          
          REGRAS DE RESPOSTA (OBJETIVIDADE E PROFISSIONALISMO):
          1. RESPOSTAS CURTAS E DIRETAS: Limite a resposta a 1 ou 2 frases no máximo. Vá direto ao ponto. Evite explicações longas, repetir informações ou detalhamento desnecessário.
          2. SEM CONTEXTO AUTOMÁTICO: NÃO liste clientes, horários ou histórico a menos que o usuário peça explicitamente.
          3. PRIVACIDADE: Nunca exponha dados de múltiplos clientes sem solicitação direta.
          4. COMANDOS SIMPLES: Se o usuário disser algo como "ok", "só isso", "não é nada", "nada mais", "não precisa de nada", responda APENAS: "Ok, se precisar é só chamar."
          5. PERGUNTAS ESSENCIAIS: Só pergunte algo se for estritamente necessário para continuar a ação.
          6. RESPOSTAS CONTEXTUAIS: Se perguntar "Quais meus clientes?", liste-os. Se perguntar "Fale sobre Maria", fale APENAS sobre Maria. Nunca expanda além do pedido.
          7. TOM PROFISSIONAL: Seja claro, direto e sem enrolação.
          8. VALIDAÇÃO DE AÇÕES: NUNCA confirme o sucesso de uma ação (agendar, cadastrar, cancelar, etc) no texto da resposta. O sistema fará a validação real e confirmará para o usuário após a execução. Apenas diga que está processando ou peça dados faltantes.
          
          REGRAS DE EXECUÇÃO:
          - Para agendar: peça Nome, Início, Término e Data (se não for hoje).
          - Para cadastrar cliente: peça Nome e Telefone.
          - Para adicionar nota ao prontuário: identifique o nome do cliente e o texto da nota.
          - Para cancelar: peça nome ou horário. Verifique se existe nos dados reais antes de tentar cancelar.
          - MÚLTIPLAS AÇÕES: Se o usuário pedir para agendar várias pessoas ou cancelar vários horários, você DEVE retornar uma LISTA de JSONs com cada ação individual.
          - SEMPRE responda em Português.
          - Se realizar uma ou mais ações, retorne uma LISTA de JSONs no final da resposta:
            [
              {"acao": "agendar", "nome": "...", "inicio": "HH:MM", "fim": "HH:MM", "data": "YYYY-MM-DD"},
              {"acao": "cancelar", "nome": "...", "horario": "HH:MM", "data": "YYYY-MM-DD"},
              {"acao": "cadastrar", "nome": "...", "telefone": "...", "email": "..."},
              {"acao": "cadastrar_nota", "nome": "...", "texto": "..."},
              {"acao": "atualizar_cliente", "nome": "...", "telefone": "...", "email": "..."}
            ]
          `,
        },
        contents: [...history, { role: 'user', parts: [{ text }] }]
      });

      let spokenIndex = 0;
      const speechPromises: Promise<void>[] = [];
      
      for await (const chunk of responseStream) {
        const chunkText = chunk.text;
        fullText += chunkText;
        
        if (onResponse) {
          // Clean JSON before speaking
          const speechText = fullText.replace(/\{[\s\S]*\}/, '').trim();
          const sentences = speechText.split(/([.!?])/);
          if (sentences.length > 2) {
            let currentFullSentences = "";
            for (let i = 0; i < sentences.length - 1; i += 2) {
              if (sentences[i+1]) {
                currentFullSentences += sentences[i] + sentences[i+1];
              }
            }
            
            const textToSpeak = currentFullSentences.substring(spokenIndex).trim();
            if (textToSpeak) {
              const p = new Promise<void>((resolve) => {
                const timeout = setTimeout(resolve, 10000);
                onResponse(textToSpeak, () => {
                  clearTimeout(timeout);
                  resolve();
                });
              });
              speechPromises.push(p);
              spokenIndex = currentFullSentences.length;
            }
          }
        }
      }

      if (onResponse) {
        const speechText = fullText.replace(/\{[\s\S]*\}/, '').trim();
        const remainingText = speechText.substring(spokenIndex).trim();
        if (remainingText) {
          const p = new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 10000);
            onResponse(remainingText, () => {
              clearTimeout(timeout);
              resolve();
            });
          });
          speechPromises.push(p);
        }
      }

      await Promise.all(speechPromises);
      // Call onSpeechEnd IMMEDIATELY after speech is done
      if (onSpeechEnd) onSpeechEnd(fullText);
      
      const jsonMatch = fullText.match(/\[[\s\S]*\]/) || fullText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const potentialJson = jsonMatch[0];
        try {
          let actions = [];
          try {
            const parsed = JSON.parse(potentialJson);
            actions = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            // Fallback for malformed or partial JSON
            const singleMatch = potentialJson.match(/\{[\s\S]*?\}/g);
            if (singleMatch) {
              actions = singleMatch.map(s => {
                try { return JSON.parse(s); } catch(e) { return null; }
              }).filter(a => a !== null);
            }
          }

          if (actions.length > 0) {
            let summaryMsg = "";
            for (const action of actions) {
              const result = await processAction(action);
              
              if (action.acao === 'cadastrar') {
                if (result === "SUCESSO") summaryMsg += "Cliente adicionado com sucesso. ";
                else if (result === "JÁ EXISTE") summaryMsg += "Esse cliente já está cadastrado. ";
                else summaryMsg += "Não consegui adicionar o cliente. Tente novamente. ";
              } else if (action.acao === 'cadastrar_nota') {
                if (result === "SUCESSO") summaryMsg += "Prontuário atualizado. ";
                else if (result === "NÃO ENCONTRADO") summaryMsg += "Cliente não encontrado. ";
                else summaryMsg += "Não consegui atualizar o prontuário. Tente novamente. ";
              } else if (action.acao === 'agendar') {
                if (result === "CONFLITO") summaryMsg += "Agendamento não realizado por conflito de horário. ";
                else summaryMsg += `Agendamento para ${action.nome} realizado com sucesso. `;
              } else if (action.acao === 'cancelar') {
                if (result === "NÃO ENCONTRADO") summaryMsg += "Agendamento não encontrado para cancelar. ";
                else summaryMsg += "Agendamento cancelado com sucesso. ";
              } else if (action.acao === 'atualizar_cliente') {
                if (result === "SUCESSO") summaryMsg += "Dados do cliente atualizados. ";
                else if (result === "NÃO ENCONTRADO") summaryMsg += "Cliente não encontrado. ";
                else summaryMsg += "Não consegui atualizar os dados. ";
              }
            }

            if (summaryMsg) {
              summaryMsg = summaryMsg.trim();
              if (onResponse) {
                await new Promise<void>((resolve) => {
                  const timeout = setTimeout(resolve, 10000);
                  onResponse(summaryMsg, () => {
                    clearTimeout(timeout);
                    resolve();
                  });
                });
              }
              await addDoc(collection(db, path), {
                text: summaryMsg,
                sender: 'iara',
                timestamp: new Date(),
                userId: user.uid,
                archived: false
              });
            }
          }
        } catch (e) {
          console.error("Action parse error for text:", potentialJson, e);
        }
      }

      const cleanText = fullText.replace(/\[[\s\S]*\]/, '').replace(/\{[\s\S]*\}/, '').trim();
      if (cleanText) {
        try {
          await addDoc(collection(db, path), {
            text: cleanText,
            sender: 'iara',
            timestamp: new Date(),
            userId: user.uid,
            archived: false
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
      
      setIsTyping(false);
      isProcessingRef.current = false;
      if (onSpeechEnd) onSpeechEnd(fullText);
      return fullText;
    } catch (error) {
      console.error("AI error:", error);
      const errorMsg = "Desculpe, tive um problema. Pode repetir?";
      if (onResponse) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 10000);
          onResponse(errorMsg, () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      await addDoc(collection(db, path), {
        text: errorMsg,
        sender: 'iara',
        timestamp: new Date(),
        userId: user.uid,
        archived: false
      });
      setIsTyping(false);
      isProcessingRef.current = false;
      if (onSpeechEnd) onSpeechEnd(errorMsg);
      return errorMsg;
    }
  };

  return { 
    handleSend: handleSend as (
      text: string, 
      onResponse?: (aiText: string, onEnd?: () => void) => void,
      onSpeechEnd?: (fullText: string) => void
    ) => Promise<string>, 
    isTyping 
  };
}

// --- Main App ---

function HistoricoView() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const path = getPath(user.uid, 'messages');
    const q = query(
      collection(db, path), 
      where('archived', '==', true)
    );
    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(), 
        timestamp: (d.data().timestamp as Timestamp).toDate() 
      } as Message));
      setMessages(msgs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return unsub;
  }, [user]);

  // Group messages by date
  const groupedMessages = messages.reduce((acc: any, msg) => {
    const date = format(msg.timestamp, 'dd/MM/yyyy');
    if (!acc[date]) acc[date] = [];
    acc[date].push(msg);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-black text-sky-900 tracking-tight">Histórico de Conversas</h2>
        <p className="text-sky-600 font-medium">Suas interações anteriores com a TRIAS.</p>
      </div>

      <Card className="p-6 space-y-8 max-h-[calc(100vh-200px)] overflow-y-auto">
        {Object.keys(groupedMessages).length === 0 && (
          <div className="text-center py-12 opacity-50">
            <History className="w-12 h-12 mx-auto mb-4 text-sky-300" />
            <p className="font-bold text-sky-900">Nenhum histórico encontrado.</p>
            <p className="text-sm text-sky-600">Encerre uma conversa na aba TRIAS para salvá-la aqui.</p>
          </div>
        )}
        {Object.entries(groupedMessages).reverse().map(([date, msgs]: [string, any]) => (
          <div key={date} className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-sky-100" />
              <span className="text-xs font-black text-sky-400 uppercase tracking-widest">{date}</span>
              <div className="h-px flex-1 bg-sky-100" />
            </div>
            <div className="space-y-3">
              {msgs.map((msg: Message) => (
                <div key={msg.id} className={cn("flex flex-col", msg.sender === 'user' ? "items-end" : "items-start")}>
                  <div className={cn(
                    "max-w-[85%] p-3 rounded-xl text-sm",
                    msg.sender === 'user' 
                      ? "bg-sky-100 text-sky-900 rounded-tr-none" 
                      : "bg-white border border-sky-100 text-sky-700 rounded-tl-none"
                  )}>
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                    <div className="text-[10px] mt-1 opacity-40 text-right">
                      {format(msg.timestamp, 'HH:mm')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [isPublicBooking] = useState(
    window.location.pathname === '/agendamento' || window.location.pathname === '/agendamento/'
  );

  useEffect(() => {
  // 🔥 SE FOR AGENDAMENTO → NÃO USA FIREBASE
  if (isPublicBooking) {
    setLoading(false);
    return;
  }

  const unsubscribe = onAuthStateChanged(auth, async (u) => {
    if (u) {
      if (u.email === AUTHORIZED_EMAIL) {
        setUser(u);
        setUnauthorized(false);
      } else {
        await signOut(auth);
        setUser(null);
        setUnauthorized(true);
      }
    } else {
      setUser(null);
    }
    setLoading(false);
  });

  return unsubscribe;
}, [isPublicBooking]);

  useEffect(() => {
    if (!loading && !user && !isPublicBooking && !unauthorized) {
      signInWithPopup(auth, googleProvider).catch(e => console.error("Auto login failed", e));
    }
  }, [user, loading, isPublicBooking, unauthorized]);

  if (loading) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-sky-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (isPublicBooking) {
    return (
      <ErrorBoundary>
        <PublicBookingView />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, loading }}>
        {user ? <Dashboard /> : <Login unauthorized={unauthorized} />}
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}

function Login({ unauthorized }: { unauthorized: boolean }) {
  return (
    <div className="min-h-screen bg-sky-100 flex flex-col items-center justify-center p-6 text-center">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full"
      >
        <div className="mb-8 flex justify-center">
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-xl border-4 border-sky-200">
            <Sparkles className="text-sky-500 w-12 h-12" />
          </div>
        </div>
        <h1 className="text-4xl font-black text-sky-900 mb-2 tracking-tight">TRIAS</h1>
        <p className="text-sky-700 mb-8 font-medium">Sua assistente inteligente para gestão de massagens.</p>
        
        {unauthorized ? (
          <Card className="border-red-100 bg-red-50 p-6">
            <AlertCircle className="text-red-500 w-12 h-12 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-red-900 mb-2">Acesso não autorizado</h2>
            <p className="text-red-700 text-sm">Desculpe, apenas o administrador autorizado pode acessar este sistema.</p>
          </Card>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <motion.div 
              animate={{ rotate: 360 }} 
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full"
            />
            <p className="text-sky-600 animate-pulse">Autenticando automaticamente...</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'agenda' | 'clientes' | 'iara' | 'historico' | 'config' | 'link_agendamento'>('agenda');
  const [clients, setClients] = useState<Client[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookingConfig, setBookingConfig] = useState<BookingConfig | null>(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  
  // IA Voice State
  const [isIAVoiceActive, setIsIAVoiceActive] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const voiceStateRef = useRef<VoiceState>('idle');
  const [wakeWord, setWakeWord] = useState<string>(localStorage.getItem('iara_wake_word') || '');
  const [isWakeWordModalOpen, setIsWakeWordModalOpen] = useState(false);
  const [newWakeWord, setNewWakeWord] = useState('');
  const recognitionRef = useRef<any>(null);
  const transcriptBufferRef = useRef<string>('');
  const lastResultTimeRef = useRef<number>(0);
  const lastWakeTimeRef = useRef<number>(0);
  const silenceCheckIntervalRef = useRef<any>(null);

  const updateVoiceState = (newState: VoiceState) => {
    setVoiceState(newState);
    voiceStateRef.current = newState;
  };

  useEffect(() => {
    // Watchdog: Reset if stuck in processing/responding for too long
    if (voiceState === 'processando' || voiceState === 'responding') {
      const timer = setTimeout(() => {
        console.log("Watchdog: Voice state stuck. Resetting.");
        updateVoiceState('escutando');
        if (isIAVoiceActive) startContinuousListening();
      }, 20000); // 20s timeout
      return () => clearTimeout(timer);
    }
  }, [voiceState, isIAVoiceActive]);
  
  const { handleSend, isTyping } = useIaraAI(clients, appointments);

  const handleChatSend = async (text: string) => {
    if (voiceStateRef.current === 'processando' || voiceStateRef.current === 'responding') return;
    
    // REGRA CRÍTICA 1 & 2: Bloqueio total ao usar chat
    if (isIAVoiceActive) {
      stopContinuousListening();
      updateVoiceState('escutando');
    }
    await handleSend(text);
    // Se a voz estava ativa, reinicia após o envio (opcional, mas vamos seguir a regra de "só escuta quando chamado")
    if (isIAVoiceActive) {
      startContinuousListening();
    }
  };

  useEffect(() => {
    if (isIAVoiceActive && wakeWord) {
      updateVoiceState('escutando');
      startContinuousListening();
    } else {
      stopContinuousListening();
      updateVoiceState('idle');
    }
    return () => stopContinuousListening();
  }, [isIAVoiceActive, wakeWord]);

  const startContinuousListening = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("Reconhecimento de voz não suportado neste navegador.");
      setIsIAVoiceActive(false);
      return;
    }

    // REGRA CRÍTICA 3: Limpar completamente qualquer texto ou áudio anterior
    transcriptBufferRef.current = '';
    setInterimTranscript('');
    lastResultTimeRef.current = 0;

    // REGRA CRÍTICA 2: Garantir que a instância anterior foi destruída
    stopContinuousListening();

    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      const currentState = voiceStateRef.current;
      
      // REGRA CRÍTICA 1 & 4: Bloqueio total se não estiver ativo ou se estiver respondendo
      if (!isIAVoiceActive || currentState === 'processando' || currentState === 'responding') {
        stopContinuousListening();
        return;
      }
      
      lastResultTimeRef.current = Date.now();
      
      let currentFinal = '';
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinal += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }
      
      // REGRA CRÍTICA 6: Isolamento total. 
      // Se estamos em 'escutando' (esperando wake word), não acumulamos nada no buffer.
      if (currentState === 'escutando') {
        const text = (currentFinal + ' ' + currentInterim).toLowerCase();
        if (text.includes(wakeWord)) {
          const now = Date.now();
          if (now - lastWakeTimeRef.current < 3000) return; // Debounce 3s
          lastWakeTimeRef.current = now;
          
          console.log("Wake word detected!");
          // REGRA CRÍTICA 2 & 5: Parar tudo e iniciar nova instância após o "Em que posso ajudar?"
          stopContinuousListening(); 
          updateVoiceState('responding');
          playSound('active');
          
          speak("Em que posso ajudar?", () => {
            // REGRA CRÍTICA 5: Nova escuta limpa para o comando
            updateVoiceState('capturando_fala');
            lastResultTimeRef.current = Date.now();
            transcriptBufferRef.current = '';
            setInterimTranscript('');
            if (isIAVoiceActive) startContinuousListening();
          }, true); 
        }
        return; 
      }

      // Se estamos capturando o comando
      if (currentFinal) {
        transcriptBufferRef.current += (transcriptBufferRef.current ? ' ' : '') + currentFinal;
      }
      setInterimTranscript(currentInterim);
    };

    // 4. Background Silence Checker (The "2 Second Rule")
    if (silenceCheckIntervalRef.current) clearInterval(silenceCheckIntervalRef.current);
    silenceCheckIntervalRef.current = setInterval(() => {
      const currentState = voiceStateRef.current;
      if ((currentState === 'capturando_fala' || currentState === 'aguardando_silencio') && lastResultTimeRef.current > 0) {
        const silenceDuration = Date.now() - lastResultTimeRef.current;
        
        if (silenceDuration >= 1000 && currentState === 'capturando_fala') {
          updateVoiceState('aguardando_silencio');
        }

        if (silenceDuration >= 2000) {
          const command = (transcriptBufferRef.current + ' ' + interimTranscript).trim();
          if (command) {
            console.log("2s Silence detected. Processing command:", command);
            // REGRA CRÍTICA 2: Parar tudo antes de processar
            stopContinuousListening(); 
            handleVoiceCommand(command);
            transcriptBufferRef.current = '';
            setInterimTranscript('');
            lastResultTimeRef.current = 0;
          }
        }
      }
    }, 200);

    const handleVoiceCommand = async (command: string) => {
      const currentState = voiceStateRef.current;
      if (currentState === 'processando' || currentState === 'responding' || !command.trim()) return;
      
      // REGRA CRÍTICA 2 & 4: Bloqueio total
      stopContinuousListening();
      updateVoiceState('processando');
      
      playSound('end');
      playSound('start');
      
      let isFirstPart = true;
      try {
        await handleSend(command, (aiTextPart, onEnd) => {
          updateVoiceState('responding');
          // REGRA CRÍTICA 4: Microfone deve estar desativado enquanto fala
          stopContinuousListening(); 
          speak(aiTextPart, onEnd, isFirstPart);
          isFirstPart = false;
        }, (fullText) => {
          playSound('success'); 
          updateVoiceState('escutando');
          // REGRA CRÍTICA 5: Reiniciar do zero após a resposta completa
          if (isIAVoiceActive) {
            startContinuousListening();
          }
        });
      } catch (e) {
        console.error("Voice command error", e);
        updateVoiceState('escutando');
        if (isIAVoiceActive) startContinuousListening();
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      console.error("Speech recognition error:", event.error);
      // Se houver erro, garante que parou e tenta reiniciar se ainda ativo
      stopContinuousListening();
      if (isIAVoiceActive && voiceStateRef.current === 'escutando') {
        setTimeout(() => startContinuousListening(), 1000);
      }
    };

    recognition.onend = () => {
      const currentState = voiceStateRef.current;
      // REGRA CRÍTICA 1 & 4: Só reinicia se estiver em estados de escuta e NÃO estiver respondendo
      if (isIAVoiceActive && (currentState === 'escutando' || currentState === 'capturando_fala' || currentState === 'aguardando_silencio')) {
        try {
          recognition.start();
        } catch (e) {}
      }
    };

    recognitionRef.current = recognition;
    setTimeout(() => {
      if (isIAVoiceActive && recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch (e) {}
      }
    }, 100);
  };

  const stopContinuousListening = () => {
    if (silenceCheckIntervalRef.current) {
      clearInterval(silenceCheckIntervalRef.current);
      silenceCheckIntervalRef.current = null;
    }
    if (recognitionRef.current) {
      // REGRA CRÍTICA 2: Destruir a instância e remover listeners
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.abort(); 
      } catch (e) {}
      recognitionRef.current = null;
    }
  };

  useEffect(() => {
    if (!user) return;

    const clientsPath = getPath(user.uid, 'clients');
    const qClients = query(collection(db, clientsPath));
    const unsubClients = onSnapshot(qClients, (snap) => {
      setClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, clientsPath);
    });

    const appsPath = getPath(user.uid, 'appointments');
    const qApps = query(collection(db, appsPath));
    const unsubApps = onSnapshot(qApps, (snap) => {
      setAppointments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Appointment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, appsPath);
    });

    const configPath = getPath(user.uid, 'bookingConfigs');
    const qConfig = query(collection(db, configPath));
    const unsubConfig = onSnapshot(qConfig, (snap) => {
      if (!snap.empty) {
        setBookingConfig({ id: snap.docs[0].id, ...snap.docs[0].data() } as BookingConfig);
      } else {
        setBookingConfig(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, configPath);
    });

    const slotsPath = getPath(user.uid, 'slots');
    const qSlots = query(collection(db, slotsPath));
    const unsubSlots = onSnapshot(qSlots, (snap) => {
      setSlots(snap.docs.map(d => ({ id: d.id, ...d.data() } as Slot)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, slotsPath);
    });

    return () => {
      unsubClients();
      unsubApps();
      unsubConfig();
      unsubSlots();
    };
  }, [user]);

  const handleSaveWakeWord = () => {
    if (newWakeWord.trim()) {
      const word = newWakeWord.trim().toLowerCase();
      setWakeWord(word);
      localStorage.setItem('iara_wake_word', word);
      setIsWakeWordModalOpen(false);
      setNewWakeWord('');
      if (!isIAVoiceActive) {
        setIsIAVoiceActive(true);
        setActiveTab('iara');
      }
    }
  };

  const handleLogout = () => signOut(auth);

  const navItems = [
    { id: 'agenda', label: 'Agenda', icon: CalendarDays },
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'iara', label: 'I.A.R.A', icon: Sparkles },
    { id: 'link_agendamento', label: 'Link de Agendamento', icon: LinkIcon },
    { id: 'config', label: 'Configurações', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-sky-50 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden bg-white border-b border-sky-100 p-4 flex justify-between items-center sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-sky-500 rounded-lg flex items-center justify-center">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-sky-900">I.A.R.A</span>
        </div>
        <button onClick={() => setSidebarOpen(true)} className="p-2 text-sky-600">
          <Menu size={24} />
        </button>
      </header>

      {/* Sidebar */}
      <AnimatePresence>
        {(isSidebarOpen || window.innerWidth >= 768) && (
          <motion.aside 
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className={cn(
              "fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-sky-100 flex flex-col transition-transform md:relative md:translate-x-0",
              !isSidebarOpen && "hidden md:flex"
            )}
          >
            <div className="p-6 border-b border-sky-50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-sky-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-200">
                  <Sparkles className="text-white w-6 h-6" />
                </div>
                <span className="font-black text-xl text-sky-900 tracking-tight">I.A.R.A</span>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="md:hidden p-2 text-sky-400">
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 p-4 space-y-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id as any); setSidebarOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all",
                    activeTab === item.id 
                      ? "bg-sky-500 text-white shadow-lg shadow-sky-100" 
                      : "text-sky-600 hover:bg-sky-50"
                  )}
                >
                  <item.icon size={20} />
                  {item.label}
                </button>
              ))}
              
              <div className="pt-4 mt-4 border-t border-sky-50">
                <button
                  onClick={() => {
                    if (!wakeWord) {
                      setIsWakeWordModalOpen(true);
                      return;
                    }
                    const newState = !isIAVoiceActive;
                    setIsIAVoiceActive(newState);
                    if (newState) setActiveTab('iara');
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all border-2",
                    isIAVoiceActive 
                      ? "bg-red-500 text-white border-red-400 shadow-lg animate-pulse" 
                      : "bg-white text-sky-600 border-sky-100 hover:bg-sky-50"
                  )}
                >
                  {isIAVoiceActive ? <MicOff size={20} /> : <Mic size={20} />}
                  IA Voice 🎤 {isIAVoiceActive ? `(${voiceState === 'capturando_fala' || voiceState === 'aguardando_silencio' ? 'ouvindo...' : 'aguardando...'})` : ''}
                </button>
                {isIAVoiceActive && (
                  <div className="mt-2 w-full text-[10px] text-sky-400 flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1">
                      <Sparkles size={10} /> Ativação: "{wakeWord}"
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsWakeWordModalOpen(true);
                      }}
                      className="text-[9px] underline hover:text-sky-600"
                    >
                      Alterar palavra
                    </button>
                  </div>
                )}
                {(voiceState === 'capturando_fala' || voiceState === 'aguardando_silencio') && (
                  <div className="mt-2 space-y-1">
                    <p className={cn(
                      "text-[10px] text-center font-bold",
                      voiceState === 'capturando_fala' ? "text-red-500 animate-bounce" : "text-amber-500"
                    )}>
                      {voiceState === 'capturando_fala' ? 'Capturando fala...' : 'Aguardando silêncio...'}
                    </p>
                    {interimTranscript && (
                      <p className="text-[10px] text-center text-sky-400 italic truncate px-2">
                        "{interimTranscript}"
                      </p>
                    )}
                  </div>
                )}
                {isIAVoiceActive && voiceState === 'escutando' && (
                  <p className="text-[10px] text-center mt-2 text-sky-400 font-medium">
                    Diga "{wakeWord}" para ativar
                  </p>
                )}
                {isIAVoiceActive && voiceState === 'processando' && (
                  <p className="text-[10px] text-center mt-2 text-sky-400 font-medium animate-pulse">
                    Processando...
                  </p>
                )}
                {isIAVoiceActive && voiceState === 'responding' && (
                  <p className="text-[10px] text-center mt-2 text-sky-400 font-medium animate-pulse">
                    Respondendo...
                  </p>
                )}
              </div>
            </nav>

            <div className="p-4 border-t border-sky-50 space-y-4">
              <div className="flex items-center gap-3 px-2">
                <img src={user?.photoURL || ''} alt="" className="w-10 h-10 rounded-full border-2 border-sky-100" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-sky-900 truncate">{user?.displayName}</p>
                  <p className="text-xs text-sky-500 truncate">{user?.email}</p>
                </div>
              </div>
              <Button variant="ghost" onClick={handleLogout} className="w-full justify-start text-red-500 hover:bg-red-50 hover:text-red-600">
                <LogOut size={18} />
                Sair
              </Button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-6xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'agenda' && <AgendaView appointments={appointments} clients={clients} />}
            {activeTab === 'clientes' && <ClientsView clients={clients} />}
            {activeTab === 'iara' && <IaraView appointments={appointments} clients={clients} handleSendProp={handleChatSend} isTypingProp={isTyping} />}
            {activeTab === 'link_agendamento' && <BookingConfigView config={bookingConfig} />}
            {activeTab === 'historico' && <HistoricoView />}
            {activeTab === 'config' && <ConfigView wakeWord={wakeWord} onSetWakeWord={() => setIsWakeWordModalOpen(true)} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {isWakeWordModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-sky-900/40 backdrop-blur-sm">
          <Card className="max-w-sm w-full p-8 space-y-6 border-sky-100 shadow-2xl">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-sky-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Mic className="text-sky-600 w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-sky-900">Palavra de Ativação</h2>
              <p className="text-sky-600 text-sm">Escolha a palavra que deseja usar para ativar a assistente por voz.</p>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-sky-400 uppercase tracking-wider">Palavra-chave</label>
                <input 
                  type="text" 
                  value={newWakeWord}
                  onChange={e => setNewWakeWord(e.target.value)}
                  placeholder="Ex: Assistente, Olá, Amigo..."
                  className="w-full p-4 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none transition-all"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleSaveWakeWord()}
                />
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsWakeWordModalOpen(false)}
                  className="flex-1 py-4 rounded-xl font-bold text-sky-600 hover:bg-sky-50 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSaveWakeWord}
                  disabled={!newWakeWord.trim()}
                  className="flex-1 py-4 rounded-xl font-bold bg-sky-500 text-white shadow-lg shadow-sky-100 hover:bg-sky-600 transition-all disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// --- Views ---

function BookingConfigView({ config }: { config: BookingConfig | null }) {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [workingDays, setWorkingDays] = useState<number[]>(config?.workingDays || [1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState(config?.startTime || '09:00');
  const [endTime, setEndTime] = useState(config?.endTime || '18:00');
  const [breakStart, setBreakStart] = useState(config?.breakStart || '');
  const [breakEnd, setBreakEnd] = useState(config?.breakEnd || '');
  const [slotInterval, setSlotInterval] = useState(config?.slotInterval || 30);
  const [services, setServices] = useState(config?.services || [{ name: 'Particular 30 min', duration: 30, description: '' }]);
  const [initialMessage, setInitialMessage] = useState(config?.initialMessage || 'Olá! Escolha um horário para seu atendimento.');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (config) {
      setWorkingDays(config.workingDays);
      setStartTime(config.startTime);
      setEndTime(config.endTime);
      setBreakStart(config.breakStart || '');
      setBreakEnd(config.breakEnd || '');
      setSlotInterval(config.slotInterval || 30);
      setServices(config.services);
      setInitialMessage(config.initialMessage || '');
    }
  }, [config]);

  const handleSave = async () => {
    if (!user) return;

    // Validation: break must be within working hours
    if (breakStart && breakEnd) {
      if (breakStart < startTime || breakEnd > endTime || breakStart >= breakEnd) {
        alert("O intervalo deve estar dentro do horário de funcionamento e o início deve ser antes do fim.");
        return;
      }
    }

    const data: any = {
      userId: user.uid,
      workingDays,
      startTime,
      endTime,
      slotInterval,
      services,
      initialMessage,
    };

    // Only include break times if both are provided
    if (breakStart && breakEnd) {
      data.breakStart = breakStart;
      data.breakEnd = breakEnd;
    } else if (config?.id) {
      // If updating and break times are removed, use deleteField
      data.breakStart = deleteField();
      data.breakEnd = deleteField();
    }

    const path = getPath(user.uid, 'bookingConfigs');
    try {
      if (config?.id) {
        await updateDoc(doc(db, path, config.id), data);
      } else {
        await addDoc(collection(db, path), data);
      }
      setIsEditing(false);
      playSound('success');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const copyLink = () => {
    const link = `${window.location.origin}/agendamento?p=${user?.uid}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    playSound('success');
  };

  const daysOfWeek = [
    { id: 0, label: 'Dom' },
    { id: 1, label: 'Seg' },
    { id: 2, label: 'Ter' },
    { id: 3, label: 'Qua' },
    { id: 4, label: 'Qui' },
    { id: 5, label: 'Sex' },
    { id: 6, label: 'Sáb' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-3xl font-black text-sky-900 tracking-tight">Link de Agendamento</h2>
        <div className="flex gap-3 w-full md:w-auto">
          <Button variant="outline" className="flex-1 md:flex-none" onClick={() => setIsEditing(true)}>
            <Settings size={18} />
            Configurar
          </Button>
          <Button className="flex-1 md:flex-none" onClick={copyLink}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? 'Copiado!' : 'Copiar Link'}
          </Button>
        </div>
      </div>

      <Card className="p-8 space-y-8">
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h3 className="font-bold text-sky-900 flex items-center gap-2">
              <CalendarIcon size={20} className="text-sky-500" />
              Dias de Atendimento
            </h3>
            <div className="flex flex-wrap gap-2">
              {daysOfWeek.map(day => (
                <div 
                  key={day.id}
                  className={cn(
                    "px-4 py-2 rounded-xl font-bold text-sm transition-all",
                    workingDays.includes(day.id) 
                      ? "bg-sky-500 text-white shadow-lg shadow-sky-100" 
                      : "bg-sky-50 text-sky-300"
                  )}
                >
                  {day.label}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-bold text-sky-900 flex items-center gap-2">
              <Clock size={20} className="text-sky-500" />
              Horário de Atendimento
            </h3>
            <div className="space-y-2">
              <p className="text-sky-600 font-medium">
                Das <span className="text-sky-900 font-bold">{startTime}</span> até as <span className="text-sky-900 font-bold">{endTime}</span>
              </p>
              <p className="text-sky-400 text-sm">
                Intervalo entre atendimentos: <span className="font-bold text-sky-600">{slotInterval} minutos</span>
              </p>
              {breakStart && breakEnd && (
                <p className="text-sky-400 text-sm italic">
                  Pausa: {breakStart} às {breakEnd}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-bold text-sky-900 flex items-center gap-2">
            <Sparkles size={20} className="text-sky-500" />
            Serviços Oferecidos
          </h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {services.map((service, i) => (
              <div key={i} className="p-4 bg-sky-50 rounded-2xl border border-sky-100 space-y-2">
                <div>
                  <p className="font-bold text-sky-900">{service.name}</p>
                  <p className="text-sm text-sky-600 font-medium">{service.duration} minutos</p>
                </div>
                {service.description && (
                  <p className="text-xs text-sky-400 line-clamp-2 italic">{service.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {initialMessage && (
          <div className="space-y-4">
            <h3 className="font-bold text-sky-900 flex items-center gap-2">
              <MessageSquare size={20} className="text-sky-500" />
              Mensagem Inicial
            </h3>
            <div className="p-4 bg-sky-50 rounded-2xl border border-sky-100 italic text-sky-700">
              "{initialMessage}"
            </div>
          </div>
        )}
      </Card>

      <Modal isOpen={isEditing} onClose={() => setIsEditing(false)} title="Configurar Agendamento">
        <ModalContent>
          <div className="space-y-6">
            <div className="space-y-3">
              <label className="text-xs font-bold text-sky-400 uppercase tracking-wider">Dias da Semana</label>
              <div className="flex flex-wrap gap-2">
                {daysOfWeek.map(day => (
                  <button
                    key={day.id}
                    onClick={() => {
                      if (workingDays.includes(day.id)) {
                        setWorkingDays(workingDays.filter(d => d !== day.id));
                      } else {
                        setWorkingDays([...workingDays, day.id].sort());
                      }
                    }}
                    className={cn(
                      "px-3 py-2 rounded-lg font-bold text-xs transition-all",
                      workingDays.includes(day.id)
                        ? "bg-sky-500 text-white"
                        : "bg-sky-50 text-sky-400 hover:bg-sky-100"
                    )}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-sky-400 uppercase tracking-wider">Início</label>
                <input 
                  type="time" 
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-sky-400 uppercase tracking-wider">Fim</label>
                <input 
                  type="time" 
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-sky-400 uppercase tracking-wider">Intervalo entre Atendimentos</label>
              <select 
                value={slotInterval}
                onChange={e => setSlotInterval(parseInt(e.target.value))}
                className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none text-sm"
              >
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={45}>45 minutos</option>
                <option value={60}>60 minutos</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold text-sky-400 uppercase tracking-wider">Intervalo / Pausa (Opcional)</label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">Início Pausa</label>
                  <input 
                    type="time" 
                    value={breakStart}
                    onChange={e => setBreakStart(e.target.value)}
                    className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">Fim Pausa</label>
                  <input 
                    type="time" 
                    value={breakEnd}
                    onChange={e => setBreakEnd(e.target.value)}
                    className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold text-sky-400 uppercase tracking-wider">Serviços</label>
              {services.map((service, i) => (
                <div key={i} className="space-y-2 p-4 bg-sky-50/30 rounded-2xl border border-sky-100">
                  <div className="flex gap-2 items-center">
                    <input 
                      type="text" 
                      value={service.name}
                      onChange={e => {
                        const newServices = [...services];
                        newServices[i].name = e.target.value;
                        setServices(newServices);
                      }}
                      placeholder="Nome do serviço"
                      className="flex-1 p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none text-sm"
                    />
                    <input 
                      type="number" 
                      value={service.duration}
                      onChange={e => {
                        const newServices = [...services];
                        newServices[i].duration = parseInt(e.target.value) || 0;
                        setServices(newServices);
                      }}
                      placeholder="Min"
                      className="w-20 p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none text-sm"
                    />
                    <button 
                      onClick={() => setServices(services.filter((_, idx) => idx !== i))}
                      className="p-2 text-red-400 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  <textarea 
                    value={service.description || ''}
                    onChange={e => {
                      const newServices = [...services];
                      newServices[i].description = e.target.value;
                      setServices(newServices);
                    }}
                    placeholder="Descrição do serviço (opcional)"
                    className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none text-xs h-20 resize-none"
                  />
                </div>
              ))}
              <Button 
                variant="outline" 
                className="w-full py-2 text-sm"
                onClick={() => setServices([...services, { name: '', duration: 30, description: '' }])}
              >
                <Plus size={16} /> Adicionar Serviço
              </Button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-sky-400 uppercase tracking-wider">Mensagem Inicial</label>
              <textarea 
                value={initialMessage}
                onChange={e => setInitialMessage(e.target.value)}
                placeholder="Ex: Olá! Escolha um horário para seu atendimento."
                className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50/50 focus:ring-2 focus:ring-sky-500 outline-none text-sm h-24 resize-none"
              />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setIsEditing(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={handleSave}>Salvar Configurações</Button>
          </div>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function PublicBookingView() {
  const [professionalId] = useState<string | null>(new URLSearchParams(window.location.search).get('p'));
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<'identification' | 'management' | 'service' | 'datetime' | 'confirmation'>('identification');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [selectedService, setSelectedService] = useState<{ name: string; duration: number; description?: string } | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [isBooking, setIsBooking] = useState(false);
  const [isNewClient, setIsNewClient] = useState(false);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [existingAppointments, setExistingAppointments] = useState<Appointment[]>([]);
  const [reschedulingAppointmentId, setReschedulingAppointmentId] = useState<string | null>(null);
  const [lastBookingWasReschedule, setLastBookingWasReschedule] = useState(false);
  const [showManagementModal, setShowManagementModal] = useState(false);

  useEffect(() => {
    if (!professionalId) {
      setError("Link de agendamento inválido.");
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const configSnap = await getDocs(query(collection(db, getPath(professionalId, 'bookingConfigs'))));
        if (configSnap.empty) {
          setError("Este profissional ainda não configurou o link de agendamento.");
          setLoading(false);
          return;
        }
        setConfig({ id: configSnap.docs[0].id, ...configSnap.docs[0].data() } as BookingConfig);

        const slotsSnap = await getDocs(query(collection(db, getPath(professionalId, 'slots'))));
        setSlots(slotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Slot)));
        
        setLoading(false);
      } catch (err) {
        console.error("Error fetching booking data:", err);
        setError("Erro ao carregar dados de agendamento.");
        setLoading(false);
      }
    };

    fetchData();
  }, [professionalId]);

  const handleIdentificationNext = async () => {
    const cleanedPhone = cleanPhone(phone);
    if (cleanedPhone.length < 10) return;

    // If we already identified this as a new client and the user provided a name, proceed
    if (isNewClient && name.trim()) {
      setStep('service');
      return;
    }

    setCheckingPhone(true);
    setExistingAppointments([]);
    try {
      console.log("Iniciando busca de cliente...");
      const clientsSnap = await getDocs(query(
        collection(db, getPath(professionalId!, 'clients')), 
        where('phone', '==', cleanedPhone)
      ));

      if (!clientsSnap.empty) {
        console.log("Cliente encontrado");
        const clientData = clientsSnap.docs[0].data();
        setName(clientData.name);
        setIsNewClient(false);
        
        // Check for future appointments
        const today = format(new Date(), 'yyyy-MM-dd');
        const appointmentsSnap = await getDocs(query(
          collection(db, getPath(professionalId!, 'appointments')),
          where('clientPhone', '==', cleanedPhone),
          where('date', '>=', today),
          where('status', '==', 'scheduled')
        ));
        
        const apps = appointmentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Appointment));
        if (apps.length > 0) {
          console.log("Cliente encontrado");
          console.log("Agendamento encontrado - abrindo modal");
          setExistingAppointments(apps);
          setShowManagementModal(true);
        } else {
          setStep('service');
        }
      } else {
        console.log("Cliente não encontrado, solicitando nome...");
        setIsNewClient(true);
      }
    } catch (err) {
      console.error("Error checking client:", err);
      // Fallback to asking for name
      setIsNewClient(true);
    } finally {
      setCheckingPhone(false);
    }
  };

  const generateTimeSlots = () => {
    if (!config || !selectedDate || !selectedService) return [];
    
    // Check if day is a working day
    const dayOfWeek = selectedDate.getDay();
    if (!config.workingDays.includes(dayOfWeek)) return [];

    const timeSlots = [];
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    
    let current = parseISO(`${dateStr}T${config.startTime}`);
    const end = parseISO(`${dateStr}T${config.endTime}`);
    const interval = config.slotInterval || 30;
    
    while (current < end) {
      const timeStr = format(current, 'HH:mm');
      const slotEnd = addMinutes(current, selectedService.duration);
      const slotEndStr = format(slotEnd, 'HH:mm');
      
      if (slotEnd > end) break;

      // Check for break interval
      const isInBreak = config.breakStart && config.breakEnd && (
        (timeStr >= config.breakStart && timeStr < config.breakEnd) ||
        (slotEndStr > config.breakStart && slotEndStr <= config.breakEnd) ||
        (timeStr <= config.breakStart && slotEndStr >= config.breakEnd)
      );

      if (isInBreak) {
        current = addMinutes(current, interval);
        continue;
      }

      const isOccupied = slots.some(s => 
        s.date === dateStr && 
        ((timeStr >= s.startTime && timeStr < s.endTime) ||
         (slotEndStr > s.startTime && slotEndStr <= s.endTime) ||
         (timeStr <= s.startTime && slotEndStr >= s.endTime))
      );

      if (!isOccupied) {
        timeSlots.push(timeStr);
      }
      current = addMinutes(current, interval);
    }
    return timeSlots;
  };

  const handleCancelAppointment = async (appId: string) => {
    if (!window.confirm("Tem certeza que deseja cancelar este agendamento?")) return;
    
    setIsBooking(true);
    try {
      // Find and delete associated slot
      const slotsPath = getPath(professionalId!, 'slots');
      const slotsSnap = await getDocs(query(collection(db, slotsPath), where('appointmentId', '==', appId)));
      for (const d of slotsSnap.docs) {
        await deleteDoc(doc(db, slotsPath, d.id));
      }
      
      // Delete appointment
      await deleteDoc(doc(db, getPath(professionalId!, 'appointments'), appId));
      
      setSlots(prev => prev.filter(s => s.appointmentId !== appId));
      setExistingAppointments(prev => prev.filter(a => a.id !== appId));
      
      alert("Agendamento cancelado com sucesso");
      setShowManagementModal(false);
      if (existingAppointments.length <= 1) {
        setStep('service');
      }
    } catch (err) {
      console.error("Error cancelling appointment:", err);
      alert("Erro ao cancelar agendamento.");
    } finally {
      setIsBooking(false);
    }
  };

  const handleBooking = async () => {
    if (!professionalId) {
      alert("Erro: Profissional não identificado.");
      return;
    }
    if (!selectedService) {
      alert("Por favor, selecione um serviço.");
      return;
    }
    if (!selectedDate) {
      alert("Por favor, selecione uma data.");
      return;
    }
    if (selectedSlots.length === 0) {
      alert("Por favor, selecione um horário.");
      return;
    }
    if (!name.trim()) {
      alert("Por favor, informe seu nome.");
      return;
    }
    const cleanedPhone = cleanPhone(phone);
    if (cleanedPhone.length < 10) {
      alert("Por favor, informe um telefone válido.");
      return;
    }
    
    setIsBooking(true);
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const startTime = selectedSlots[0];
      const endTime = format(addMinutes(parseISO(`${dateStr}T${startTime}`), selectedService.duration), 'HH:mm');

      // 0. Validation against config
      if (config) {
        const dayOfWeek = selectedDate.getDay();
        if (!config.workingDays.includes(dayOfWeek)) {
          alert("Erro: O profissional não atende neste dia da semana.");
          setIsBooking(false);
          return;
        }

        if (startTime < config.startTime || endTime > config.endTime) {
          alert("Erro: Horário fora do período de atendimento.");
          setIsBooking(false);
          return;
        }

        if (config.breakStart && config.breakEnd) {
          const isInBreak = (
            (startTime >= config.breakStart && startTime < config.breakEnd) ||
            (endTime > config.breakStart && endTime <= config.breakEnd) ||
            (startTime <= config.breakStart && endTime >= config.breakEnd)
          );
          if (isInBreak) {
            alert("Erro: Este horário coincide com o intervalo de pausa do profissional.");
            setIsBooking(false);
            return;
          }
        }
      }

      // 0. Fresh check for conflicts (race condition prevention)
      let freshSlots: Slot[] = [];
      try {
        const slotsSnap = await getDocs(query(
          collection(db, getPath(professionalId!, 'slots')), 
          where('date', '==', dateStr)
        ));
        freshSlots = slotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Slot));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, getPath(professionalId!, 'slots'));
      }

      const isOccupied = freshSlots.some(s => 
        ((startTime >= s.startTime && startTime < s.endTime) ||
         (endTime > s.startTime && endTime <= s.endTime) ||
         (startTime <= s.startTime && endTime >= s.endTime))
      );

      if (isOccupied) {
        alert("Desculpe, este horário acabou de ser ocupado. Por favor, escolha outro.");
        setStep('datetime');
        // Refresh slots in state too
        setSlots(prev => {
          const filtered = prev.filter(s => s.date !== dateStr);
          return [...filtered, ...freshSlots];
        });
        setIsBooking(false);
        return;
      }

      // 1. Check/Create Client
      let clientId = '';
      try {
        const clientsSnap = await getDocs(query(
          collection(db, getPath(professionalId!, 'clients')), 
          where('phone', '==', cleanedPhone)
        ));
        
        if (clientsSnap.empty) {
          const newClientRef = await addDoc(collection(db, getPath(professionalId!, 'clients')), {
            name: name.trim(),
            phone: cleanedPhone,
            userId: professionalId,
            prontuarios: [],
            timestamp: serverTimestamp()
          });
          clientId = newClientRef.id;
        } else {
          clientId = clientsSnap.docs[0].id;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, getPath(professionalId!, 'clients'));
      }

      if (!clientId) {
        throw new Error("Falha ao identificar ou criar cliente.");
      }

      // 2. Create Appointment
      let appRef;
      try {
        const durationStr = `${selectedService.duration}min`;
        appRef = await addDoc(collection(db, getPath(professionalId!, 'appointments')), {
          clientName: name.trim(),
          clientPhone: cleanedPhone,
          clientId,
          serviceName: selectedService.name,
          servico_nome: selectedService.name,
          servico_duracao: durationStr,
          startTime,
          endTime,
          date: dateStr,
          status: 'scheduled',
          userId: professionalId,
          timestamp: serverTimestamp()
        });

        // Create history entry automatically
        await addDoc(collection(db, getPath(professionalId!, 'serviceHistory')), {
          clientId,
          clientName: name.trim(),
          date: dateStr,
          startTime,
          serviceName: selectedService.name,
          duration: durationStr,
          userId: professionalId,
          timestamp: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, getPath(professionalId!, 'appointments'));
      }

      // 3. Create Slot
      try {
        await addDoc(collection(db, getPath(professionalId!, 'slots')), {
          userId: professionalId,
          date: dateStr,
          startTime,
          endTime,
          appointmentId: appRef.id
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, getPath(professionalId!, 'slots'));
      }

      // Update local slots
      setSlots(prev => [...prev, {
        id: 'temp-' + Date.now(),
        userId: professionalId,
        date: dateStr,
        startTime,
        endTime,
        appointmentId: appRef.id
      } as Slot]);

      // 4. If rescheduling, delete old appointment and its slots
      if (reschedulingAppointmentId) {
        setLastBookingWasReschedule(true);
        try {
          const oldSlotsPath = getPath(professionalId!, 'slots');
          const oldSlotsSnap = await getDocs(query(collection(db, oldSlotsPath), where('appointmentId', '==', reschedulingAppointmentId)));
          for (const d of oldSlotsSnap.docs) {
            await deleteDoc(doc(db, oldSlotsPath, d.id));
          }
          await deleteDoc(doc(db, getPath(professionalId!, 'appointments'), reschedulingAppointmentId));
          
          // Update local state to remove old slots
          setSlots(prev => prev.filter(s => s.appointmentId !== reschedulingAppointmentId));
          setReschedulingAppointmentId(null);
        } catch (err) {
          console.error("Error removing old appointment during reschedule:", err);
        }
      } else {
        setLastBookingWasReschedule(false);
      }

      setStep('confirmation');
      playSound('success');
    } catch (err) {
      console.error("Booking error:", err);
      let message = "Não foi possível concluir o agendamento.";
      
      try {
        const parsedError = JSON.parse((err as Error).message);
        if (parsedError.error.includes("permission")) {
          message += "\n\nErro de permissão no banco de dados. Por favor, contate o suporte.";
        } else {
          message += `\n\nDetalhes: ${parsedError.error}`;
        }
      } catch (e) {
        message += `\n\n${ (err as Error).message }`;
      }
      
      alert(message);
    } finally {
      setIsBooking(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-sky-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        <p className="font-bold text-sky-900">Carregando...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-sky-50 flex items-center justify-center p-6">
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        <XCircle className="w-16 h-16 text-red-400 mx-auto" />
        <h2 className="text-2xl font-black text-sky-900">Ops!</h2>
        <p className="text-sky-600 font-medium">{error}</p>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-sky-50 p-4 md:p-8 flex justify-center">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black text-sky-900 tracking-tight">Agendamento Online</h1>
          <p className="text-sky-600 font-medium">Reserve seu horário em poucos cliques.</p>
        </div>

        <Modal 
          isOpen={showManagementModal} 
          onClose={() => setShowManagementModal(false)} 
          title="Gerenciar Agendamento"
        >
          <div className="p-6 space-y-6">
            <div className="text-center space-y-2">
              <AlertCircle className="w-12 h-12 text-sky-500 mx-auto" />
              <h3 className="text-xl font-bold text-sky-900">Olá, eu sou a I.A.R.A!</h3>
              <p className="text-sky-600">Você já possui um agendamento futuro conosco.</p>
            </div>

            <div className="space-y-4">
              {existingAppointments.map((app, i) => (
                <div key={i} className="p-5 rounded-3xl bg-sky-50 border-2 border-sky-100 space-y-3">
                  <div className="font-black text-sky-900 text-lg">{app.serviceName}</div>
                  <div className="flex items-center gap-2 text-sky-600 font-bold">
                    <CalendarIcon size={16} /> {format(parseISO(app.date), "dd 'de' MMMM", { locale: ptBR })}
                  </div>
                  <div className="flex items-center gap-2 text-sky-500 font-medium">
                    <Clock size={16} /> {app.startTime} às {app.endTime}
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3 pt-2">
                    <Button 
                      variant="primary" 
                      onClick={() => {
                        const service = config?.services.find(s => s.name === app.serviceName);
                        if (service) setSelectedService(service);
                        setReschedulingAppointmentId(app.id);
                        setShowManagementModal(false);
                        setStep('datetime');
                      }}
                      className="w-full py-4 rounded-2xl"
                    >
                      Reagendar agendamento
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => handleCancelAppointment(app.id)}
                      className="w-full py-4 rounded-2xl text-red-500 border-red-100 hover:bg-red-50"
                    >
                      Cancelar agendamento
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            
            <Button 
              variant="ghost" 
              onClick={() => {
                setReschedulingAppointmentId(null);
                setShowManagementModal(false);
                setStep('service');
              }} 
              className="w-full text-sky-500"
            >
              Fazer novo agendamento
            </Button>
          </div>
        </Modal>

        <Card className="p-6 md:p-8">
          <AnimatePresence mode="wait">
            {step === 'identification' && (
              <motion.div 
                key="id"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-black text-sky-900">Quem está agendando?</h3>
                  <p className="text-sky-500 text-sm">{config?.initialMessage || "Olá! Por favor, identifique-se para começar."}</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-bold text-sky-900">Seu WhatsApp</label>
                    <input 
                      type="tel"
                      placeholder="(00) 00000-0000"
                      className="w-full p-4 rounded-2xl border-2 border-sky-50 bg-sky-50/50 focus:border-sky-500 focus:bg-white outline-none transition-all"
                      value={formatPhone(phone)}
                      onChange={e => {
                        setPhone(e.target.value);
                        if (isNewClient) setIsNewClient(false);
                      }}
                    />
                  </div>
                  {isNewClient && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-1"
                    >
                      <label className="text-sm font-bold text-sky-900">Seu Nome Completo</label>
                      <input 
                        type="text"
                        placeholder="Ex: Maria Silva"
                        className="w-full p-4 rounded-2xl border-2 border-sky-50 bg-sky-50/50 focus:border-sky-500 focus:bg-white outline-none transition-all"
                        value={name}
                        onChange={e => setName(e.target.value)}
                      />
                    </motion.div>
                  )}
                  <div className="flex gap-3 mt-4">
                    {isNewClient && (
                      <Button 
                        variant="outline" 
                        onClick={() => setIsNewClient(false)} 
                        className="flex-1 py-5 text-lg rounded-2xl"
                      >
                        Voltar
                      </Button>
                    )}
                    <Button 
                      disabled={checkingPhone || cleanPhone(phone).length < 10 || (isNewClient && !name)}
                      onClick={handleIdentificationNext}
                      className={cn("text-lg rounded-2xl py-5", isNewClient ? "flex-[2]" : "w-full")}
                    >
                      {checkingPhone ? "Verificando..." : "Próximo Passo"} <ChevronRight size={20} />
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 'service' && (
              <motion.div 
                key="service"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-black text-sky-900">O que vamos fazer?</h3>
                  <p className="text-sky-500 text-sm">Selecione o serviço desejado.</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {config?.services.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedService(s)}
                      className={cn(
                        "p-5 rounded-2xl border-2 text-left transition-all flex justify-between items-center",
                        selectedService?.name === s.name 
                          ? "border-sky-500 bg-sky-50 ring-4 ring-sky-500/10" 
                          : "border-sky-50 bg-white hover:border-sky-200"
                      )}
                    >
                      <div className="flex-1">
                        <div className="font-black text-sky-900 text-lg">{s.name}</div>
                        <div className="text-sm text-sky-500 flex items-center gap-1"><Clock size={14} /> {s.duration} minutos</div>
                        {selectedService?.name === s.name && s.description && (
                          <p className="text-sm text-sky-500 italic mt-2 leading-relaxed">{s.description}</p>
                        )}
                      </div>
                      {selectedService?.name === s.name && <CheckCircle2 className="text-sky-500" />}
                    </button>
                  ))}
                </div>

                  {selectedService && selectedService.description && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 rounded-2xl bg-sky-50 border border-sky-100 text-sky-700 text-sm italic mt-4"
                    >
                      {selectedService.description}
                    </motion.div>
                  )}
                  <div className="flex gap-3 mt-6">
                  <Button variant="outline" onClick={() => {
                    if (existingAppointments.length > 0) setShowManagementModal(true);
                    setStep('identification');
                  }} className="flex-1 py-4 rounded-2xl">Voltar</Button>
                  <Button disabled={!selectedService} onClick={() => setStep('datetime')} className="flex-[2] py-4 rounded-2xl">Próximo</Button>
                </div>
              </motion.div>
            )}

            {step === 'datetime' && (
              <motion.div 
                key="datetime"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-black text-sky-900">Quando?</h3>
                  <p className="text-sky-500 text-sm">Escolha o melhor dia e horário.</p>
                </div>
                
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-bold text-sky-900">Data</label>
                    <input 
                      type="date"
                      min={format(new Date(), 'yyyy-MM-dd')}
                      className="w-full p-4 rounded-2xl border-2 border-sky-50 bg-sky-50/50 focus:border-sky-500 focus:bg-white outline-none transition-all"
                      value={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''}
                      onChange={e => {
                        setSelectedDate(parseISO(e.target.value));
                        setSelectedSlots([]);
                      }}
                    />
                  </div>

                  {selectedDate && (
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-sky-900">Horários Disponíveis</label>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[200px] overflow-y-auto p-1">
                        {!config.workingDays.includes(selectedDate.getDay()) ? (
                          <div className="col-span-full py-8 text-center text-red-400 font-bold bg-red-50/50 rounded-2xl">
                            Este dia não está disponível para agendamento.
                          </div>
                        ) : generateTimeSlots().length === 0 ? (
                          <div className="col-span-full py-8 text-center text-sky-400 font-bold bg-sky-50/50 rounded-2xl">
                            Sem horários para este dia.
                          </div>
                        ) : (
                          generateTimeSlots().map((t) => (
                            <button
                              key={t}
                              onClick={() => setSelectedSlots([t])}
                              className={cn(
                                "py-3 rounded-xl font-bold text-sm transition-all",
                                selectedSlots.includes(t) 
                                  ? "bg-sky-500 text-white shadow-md scale-105" 
                                  : "bg-white border border-sky-100 text-sky-600 hover:bg-sky-50"
                              )}
                            >
                              {t}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep('service')} className="flex-1 py-4 rounded-2xl">Voltar</Button>
                  <Button disabled={selectedSlots.length === 0} onClick={handleBooking} className="flex-[2] py-4 rounded-2xl">
                    {isBooking ? "Agendando..." : "Confirmar Agendamento"}
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 'confirmation' && (
              <motion.div 
                key="conf"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-6 py-8"
              >
                <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="text-green-500 w-12 h-12" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-3xl font-black text-sky-900">
                    {lastBookingWasReschedule ? "Reagendado!" : "Agendado!"}
                  </h3>
                  <p className="text-sky-600">
                    {lastBookingWasReschedule 
                      ? "Agendamento reagendado com sucesso." 
                      : "Seu horário foi reservado com sucesso."}
                    <br/> Te esperamos em breve!
                  </p>
                </div>
                <Button onClick={() => window.location.reload()} className="w-full py-4 rounded-2xl">Fazer outro agendamento</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>
    </div>
  );
}

// --- Views ---

function ConfigView({ wakeWord, onSetWakeWord }: { wakeWord: string; onSetWakeWord: () => void }) {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-black text-sky-900 tracking-tight">Configurações</h2>
      
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center">
              <Mic className="text-sky-600 w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sky-900">Palavra de Ativação</p>
              <p className="text-sm text-sky-600">Palavra atual: <span className="font-bold">"{wakeWord || 'Não definida'}"</span></p>
            </div>
          </div>
          <Button variant="outline" onClick={onSetWakeWord}>Alterar</Button>
        </div>
      </Card>
    </div>
  );
}

function AgendaView({ appointments, clients }: { appointments: Appointment[]; clients: Client[] }) {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [conflictWarning, setConflictWarning] = useState(false);
  const [newApp, setNewApp] = useState({ 
    clientName: '', 
    clientPhone: '', 
    serviceName: '', 
    startTime: '09:00', 
    endTime: '10:00', 
    date: format(new Date(), 'yyyy-MM-dd') 
  });
  const [whatsappApp, setWhatsappApp] = useState<Appointment | null>(null);

  const handleWhatsApp = (app: Appointment, type: 'confirm' | 'cancel') => {
    const client = app.clientId 
      ? clients.find(c => c.id === app.clientId)
      : clients.find(c => c.name === app.clientName);
      
    if (!client) {
      alert("Cliente não encontrado para este agendamento.");
      return;
    }

    const phone = "55" + cleanPhone(client.phone);
    const dateStr = format(parseISO(app.date), 'dd/MM/yyyy');
    const timeStr = app.startTime;

    let message = "";
    if (type === 'confirm') {
      message = `Olá ${client.name}, tudo bem?\nConfirmando seu atendimento no dia ${dateStr} às ${timeStr}. Está tudo certo para você?`;
    } else {
      message = `Olá ${client.name}, tudo bem?\nPor um imprevisto, preciso desmarcar seu atendimento no dia ${dateStr} às ${timeStr}.\nGostaria de reagendar para outro horário?`;
    }

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/${phone}?text=${encodedMessage}`, '_blank');
    setWhatsappApp(null);
  };

  const filteredApps = appointments
    .filter(app => app.date === format(selectedDate, 'yyyy-MM-dd') && app.status === 'scheduled')
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const handleAddApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    // Check for conflicts
    const hasConflict = appointments.some(app => 
      app.date === newApp.date && 
      app.status === 'scheduled' &&
      ((newApp.startTime >= app.startTime && newApp.startTime < app.endTime) ||
       (newApp.endTime > app.startTime && newApp.endTime <= app.endTime) ||
       (newApp.startTime <= app.startTime && newApp.endTime >= app.endTime))
    );

    if (hasConflict) {
      setConflictWarning(true);
      setTimeout(() => setConflictWarning(false), 3000);
      return;
    }

    const path = getPath(user.uid, 'appointments');
    try {
      const client = clients.find(c => c.name === newApp.clientName);
      
      // Calculate duration
      const start = parseISO(`${newApp.date}T${newApp.startTime}`);
      const end = parseISO(`${newApp.date}T${newApp.endTime}`);
      const durationMin = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
      const durationStr = `${durationMin}min`;

      const appData = {
        ...newApp,
        servico_nome: newApp.serviceName,
        servico_duracao: durationStr,
        clientId: client?.id,
        status: 'scheduled',
        userId: user.uid,
        timestamp: serverTimestamp()
      };

      const appRef = await addDoc(collection(db, path), appData);

      // Create history entry automatically
      if (client?.id) {
        await addDoc(collection(db, getPath(user.uid, 'serviceHistory')), {
          clientId: client.id,
          clientName: client.name,
          date: newApp.date,
          startTime: newApp.startTime,
          serviceName: newApp.serviceName,
          duration: durationStr,
          userId: user.uid,
          timestamp: serverTimestamp()
        });
      }

      // Create slot
      await addDoc(collection(db, getPath(user.uid, 'slots')), {
        userId: user.uid,
        date: newApp.date,
        startTime: newApp.startTime,
        endTime: newApp.endTime,
        appointmentId: appRef.id
      });

      setAddModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const handleCancel = async (id: string) => {
    const path = getPath(user.uid, 'appointments');
    try {
      await deleteDoc(doc(db, path, id));
      // Delete corresponding slot
      const slotsPath = getPath(user.uid, 'slots');
      const slotsSnap = await getDocs(query(collection(db, slotsPath), where('appointmentId', '==', id)));
      for (const slotDoc of slotsSnap.docs) {
        await deleteDoc(doc(db, slotsPath, slotDoc.id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${path}/${id}`);
    }
  };

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {conflictWarning && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-red-500 text-white px-8 py-4 rounded-2xl shadow-2xl font-black tracking-widest"
          >
            HORÁRIO OCUPADO
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-sky-900 tracking-tight">Agenda</h2>
          <p className="text-sky-600 font-medium">{format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setSelectedDate(new Date()); setCurrentMonth(new Date()); }}>Hoje</Button>
          <Button onClick={() => setAddModalOpen(true)}>
            <Plus size={20} />
            Novo Agendamento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Calendar Full Month */}
        <Card className="lg:col-span-1 p-6 h-fit">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => setCurrentMonth(prev => addMonths(prev, -1))} className="p-2 hover:bg-sky-50 rounded-full text-sky-600">
              <ChevronLeft size={20} />
            </button>
            <span className="font-bold text-sky-900 capitalize">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</span>
            <button onClick={() => setCurrentMonth(prev => addMonths(prev, 1))} className="p-2 hover:bg-sky-50 rounded-full text-sky-600">
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-sky-400 mb-2">
            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              const isSelected = isSameDay(day, selectedDate);
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const hasApp = appointments.some(app => app.date === format(day, 'yyyy-MM-dd') && app.status === 'scheduled');
              
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(day)}
                  className={cn(
                    "relative aspect-square rounded-xl flex items-center justify-center transition-all text-sm font-bold",
                    !isCurrentMonth && "text-sky-200",
                    isCurrentMonth && !isSelected && "text-sky-600 hover:bg-sky-50",
                    isSelected ? "bg-sky-500 text-white shadow-lg z-10" : "bg-transparent"
                  )}
                >
                  {format(day, 'd')}
                  {hasApp && !isSelected && (
                    <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-sky-400 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Timeline */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sky-900">Atendimentos do dia</h3>
            <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">{filteredApps.length} agendado(s)</span>
          </div>
          {filteredApps.length === 0 ? (
            <div className="bg-white/50 border-2 border-dashed border-sky-200 rounded-3xl p-12 text-center">
              <Clock className="mx-auto text-sky-200 mb-4" size={48} />
              <p className="text-sky-400 font-bold text-xl">Nenhum atendimento</p>
              <p className="text-sky-300">Selecione outro dia ou agende um novo cliente.</p>
            </div>
          ) : (
            filteredApps.map((app) => (
              <motion.div 
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                key={app.id} 
              >
                <Card className="flex justify-between items-center gap-3 p-3 md:p-5 hover:shadow-md transition-shadow group">
                  <div className="bg-sky-50 p-3 rounded-2xl text-sky-600 font-black text-center min-w-[80px]">
                    <div className="text-xs uppercase opacity-50">Início</div>
                    <div className="text-lg">{app.startTime}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-black text-base md:text-xl text-sky-900 truncate">
                      {app.clientName}
                    </h4>
                    <div className="flex flex-col text-sky-500 text-sm mt-1">
                      <span className="flex items-center gap-1 font-bold"><Clock size={14} /> {app.startTime} - {app.endTime}</span>
                      <span className="text-sky-400 font-medium">
                        {app.servico_nome || app.serviceName} 
                        {app.servico_duracao ? ` - ${app.servico_duracao}` : ''} 
                        {app.servico_tipo ? ` (${app.servico_tipo})` : ''}
                      </span>
                    </div>
                  </div>
               <div className="flex gap-2">
                  <button
                    onClick={() => setWhatsappApp(app)}
                    className="p-2 text-green-600 bg-green-50 rounded-xl"
                    title="Enviar WhatsApp"
                  >
                  </button>
                  <button 
                    onClick={() => handleCancel(app.id)}
                    className="p-2 md:p-3 text-red-600 bg-red-50 rounded-xl transition-all"
                    title="Excluir agendamento"
                  >
                    <Trash2 size={20} />
                  </button>
               </div>
                </Card>
              </motion.div>
            ))
          )}
        </div>
      </div>

      <Modal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} title="Novo Agendamento">
        <form onSubmit={handleAddApp} className="flex flex-col flex-1 overflow-hidden">
          <ModalContent>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-bold text-sky-900">Cliente</label>
                <select 
                  required
                  className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none"
                  value={newApp.clientName}
                  onChange={e => {
                    const client = clients.find(c => c.name === e.target.value);
                    setNewApp({...newApp, clientName: e.target.value, clientPhone: client?.phone || ''});
                  }}
                >
                  <option value="">Selecione um cliente</option>
                  {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-bold text-sky-900">Serviço</label>
                <input 
                  type="text" required
                  placeholder="Ex: Massagem Relaxante"
                  className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none"
                  value={newApp.serviceName}
                  onChange={e => setNewApp({...newApp, serviceName: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-bold text-sky-900">Início</label>
                  <input 
                    type="time" required
                    className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none"
                    value={newApp.startTime}
                    onChange={e => setNewApp({...newApp, startTime: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-bold text-sky-900">Término</label>
                  <input 
                    type="time" required
                    className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none"
                    value={newApp.endTime}
                    onChange={e => setNewApp({...newApp, endTime: e.target.value})}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-bold text-sky-900">Data</label>
                <input 
                  type="date" required
                  className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none"
                  value={newApp.date}
                  onChange={e => setNewApp({...newApp, date: e.target.value})}
                />
              </div>
            </div>
          </ModalContent>
          <ModalFooter>
            <Button type="submit" className="w-full py-4">Confirmar Agendamento</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal 
        isOpen={!!whatsappApp} 
        onClose={() => setWhatsappApp(null)} 
        title="Enviar Mensagem WhatsApp"
      >
        <ModalContent>
          <div className="space-y-4">
            <p className="text-sky-600 text-sm mb-4">
              Escolha o tipo de mensagem para enviar para <strong>{whatsappApp?.clientName}</strong>:
            </p>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => whatsappApp && handleWhatsApp(whatsappApp, 'confirm')}
                className="w-full p-4 text-left rounded-2xl border-2 border-sky-100 hover:border-green-500 hover:bg-green-50 transition-all group"
              >
                <div className="font-bold text-sky-900 group-hover:text-green-600">1. Confirmar agendamento</div>
                <div className="text-xs text-sky-400 mt-1">Envia mensagem de confirmação para a data e hora marcada.</div>
              </button>
              <button
                onClick={() => whatsappApp && handleWhatsApp(whatsappApp, 'cancel')}
                className="w-full p-4 text-left rounded-2xl border-2 border-sky-100 hover:border-red-500 hover:bg-red-50 transition-all group"
              >
                <div className="font-bold text-sky-900 group-hover:text-red-600">2. Desmarcar agendamento</div>
                <div className="text-xs text-sky-400 mt-1">Envia mensagem informando imprevisto e sugerindo reagendamento.</div>
              </button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </div>
  );
}

function ClientsView({ clients }: { clients: Client[] }) {
  const { user } = useAuth();
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isHistoryModalOpen, setHistoryModalOpen] = useState(false);
  const [isNewNoteModalOpen, setNewNoteModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '' });
  const [newNoteText, setNewNoteText] = useState('');
  const [clientRecords, setClientRecords] = useState<Prontuario[]>([]);
  const [serviceHistory, setServiceHistory] = useState<ServiceHistory[]>([]);
  const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedClient || !user) return;
    const current = clients.find(c => c.id === selectedClient.id);
    if (current) {
      setClientRecords(current.prontuarios || []);
    }

    // Fetch service history
    const path = getPath(user.uid, 'serviceHistory');
    const q = query(
      collection(db, path),
      where('clientId', '==', selectedClient.id)
    );

    const unsub = onSnapshot(q, (snap) => {
      const history = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as ServiceHistory));
      // Sort by date and time descending
      setServiceHistory(history.sort((a, b) => {
        const dateA = `${a.date}T${a.startTime}`;
        const dateB = `${b.date}T${b.startTime}`;
        return dateB.localeCompare(dateA);
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return unsub;
  }, [clients, selectedClient, user]);

  const filteredClients = clients
    .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const path = getPath(user.uid, 'clients');
    try {
      const clientData = {
        name: newClient.name,
        phone: cleanPhone(newClient.phone),
        userId: user.uid,
        ...(newClient.email ? { email: newClient.email } : {}),
        prontuarios: [],
        timestamp: serverTimestamp()
      };
      await addDoc(collection(db, path), clientData);
      setAddModalOpen(false);
      setNewClient({ name: '', phone: '', email: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedClient || !newNoteText.trim()) return;
    const path = getPath(user.uid, 'clients');
    try {
      const now = new Date();
      const newNote = {
        texto: newNoteText,
        data: format(now, 'dd/MM/yyyy'),
        hora: format(now, 'HH:mm')
      };
      await updateDoc(doc(db, path, selectedClient.id), {
        prontuarios: arrayUnion(newNote)
      });
      setNewNoteModalOpen(false);
      setNewNoteText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handleDelete = (client: Client) => {
    setClientToDelete(client);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!clientToDelete || !user) return;
    
    const path = getPath(user.uid, 'clients');
    try {
      // 1. Delete linked appointments
      const appointmentsSnap = await getDocs(query(
        collection(db, getPath(user.uid, 'appointments')), 
        where('clientPhone', '==', clientToDelete.phone)
      ));
      
      const deletePromises = appointmentsSnap.docs.map(d => deleteDoc(d.ref));
      
      // 2. Delete linked slots
      const slotsSnap = await getDocs(query(
        collection(db, getPath(user.uid, 'slots'))
      ));
      
      const deletedAppIds = appointmentsSnap.docs.map(d => d.id);
      const slotDeletePromises = slotsSnap.docs
        .filter(d => d.data().appointmentId && deletedAppIds.includes(d.data().appointmentId))
        .map(d => deleteDoc(d.ref));

      await Promise.all([...deletePromises, ...slotDeletePromises]);

      // 3. Delete client
      await deleteDoc(doc(db, path, clientToDelete.id));
      
      setDeleteModalOpen(false);
      setClientToDelete(null);
      setDeleteMessage("Cliente excluído com sucesso");
      setTimeout(() => setDeleteMessage(null), 3000);
      playSound('success');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${path}/${clientToDelete.id}`);
    }
  };

  const openHistory = (client: Client) => {
    setSelectedClient(client);
    setHistoryModalOpen(true);
  };

  const openNewNote = (client: Client) => {
    setSelectedClient(client);
    setNewNoteModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-sky-900 tracking-tight">Clientes</h2>
          <p className="text-sky-600 font-medium">{clients.length} clientes cadastrados</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-400" size={18} />
            <input 
              type="text"
              placeholder="Buscar cliente..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-sky-100 bg-white focus:ring-2 focus:ring-sky-500 outline-none transition-all"
            />
          </div>
          <Button onClick={() => setAddModalOpen(true)}>
            <UserPlus size={20} />
            Novo
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-sky-100">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sky-50/50 border-b border-sky-100">
                <th className="px-6 py-4 text-xs font-bold text-sky-400 uppercase tracking-wider">Nome</th>
                <th className="px-6 py-4 text-xs font-bold text-sky-400 uppercase tracking-wider">Telefone</th>
                <th className="px-6 py-4 text-xs font-bold text-sky-400 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-50">
              {filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-sky-50/30 transition-colors group">
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => openHistory(client)}
                      className="font-bold text-sky-900 hover:text-sky-600 transition-colors text-left"
                    >
                      {client.name}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-sky-600 font-medium">{formatPhone(client.phone)}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button 
                        onClick={() => openHistory(client)}
                        title="Prontuário"
                        className="p-2 text-sky-400 hover:text-sky-600 transition-colors"
                      >
                        <Paperclip size={18} />
                      </button>
                      <button 
                        onClick={() => openNewNote(client)}
                        title="Nova Nota"
                        className="p-2 text-sky-400 hover:text-sky-600 transition-colors"
                      >
                        <FileText size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(client)}
                        title="Excluir"
                        className="p-2 text-sky-200 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredClients.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-sky-400 font-medium">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Client Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} title="Novo Cliente">
        <form onSubmit={handleAddClient} className="flex flex-col flex-1 overflow-hidden">
          <ModalContent>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-bold text-sky-900">Nome Completo</label>
                <input 
                  type="text" required
                  className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none"
                  value={newClient.name}
                  onChange={e => setNewClient({...newClient, name: e.target.value})}
                  placeholder="Ex: Maria Silva"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-bold text-sky-900">Telefone</label>
                <input 
                  type="tel" required
                  className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none"
                  value={newClient.phone}
                  onChange={e => setNewClient({...newClient, phone: formatPhone(e.target.value)})}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-bold text-sky-900">Email (Opcional)</label>
                <input 
                  type="email"
                  className="w-full p-3 rounded-xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none"
                  value={newClient.email}
                  onChange={e => setNewClient({...newClient, email: e.target.value})}
                  placeholder="email@exemplo.com"
                />
              </div>
            </div>
          </ModalContent>
          <ModalFooter>
            <Button type="submit" className="w-full py-4">Salvar Cliente</Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* History Modal */}
      <Modal isOpen={isHistoryModalOpen} onClose={() => setHistoryModalOpen(false)} title={`Prontuário e Histórico: ${selectedClient?.name}`}>
        <ModalContent>
          <div className="space-y-8">
            {/* Service History Section */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-sky-400 uppercase tracking-widest flex items-center gap-2">
                <Clock size={14} /> Histórico de Atendimentos
              </h4>
              {serviceHistory.length === 0 ? (
                <div className="text-center py-4 text-sky-300 italic text-sm">
                  Nenhum atendimento registrado.
                </div>
              ) : (
                <div className="space-y-3">
                  {serviceHistory.map((item) => (
                    <div key={item.id} className="p-4 bg-white border-2 border-sky-50 rounded-2xl shadow-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-black text-sky-900">{item.serviceName}</div>
                        <div className="text-[10px] font-bold bg-sky-100 text-sky-600 px-2 py-1 rounded-lg uppercase">
                          {item.type}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-sky-500 font-medium">
                        <span className="flex items-center gap-1"><Calendar size={12} /> {format(parseISO(item.date), 'dd/MM/yyyy')}</span>
                        <span className="flex items-center gap-1"><Clock size={12} /> {item.startTime}</span>
                        <span className="flex items-center gap-1"><Activity size={12} /> {item.duration}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes Section */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-sky-400 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} /> Anotações e Evolução
              </h4>
              {clientRecords.length === 0 ? (
                <div className="text-center py-4 text-sky-300 italic text-sm">
                  Nenhuma anotação encontrada.
                </div>
              ) : (
                <div className="space-y-3">
                  {clientRecords.map((record, idx) => (
                    <div key={idx} className="p-4 bg-sky-50/50 border border-sky-100 rounded-2xl space-y-2">
                      <div className="flex justify-between items-center text-[10px] font-black text-sky-400 uppercase tracking-widest">
                        <span>[{record.data} - {record.hora}]</span>
                      </div>
                      <div className="text-sky-900 whitespace-pre-wrap text-sm leading-relaxed">
                        {record.texto}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button onClick={() => { setHistoryModalOpen(false); setNewNoteModalOpen(true); }} className="w-full py-4">
            <Plus size={18} />
            Nova Anotação
          </Button>
        </ModalFooter>
      </Modal>

      {/* New Note Modal */}
      <Modal isOpen={isNewNoteModalOpen} onClose={() => setNewNoteModalOpen(false)} title={`Nova Nota: ${selectedClient?.name}`}>
        <form onSubmit={handleAddNote} className="flex flex-col flex-1 overflow-hidden">
          <ModalContent>
            <div className="space-y-1">
              <label className="text-sm font-bold text-sky-900">Anotação</label>
              <textarea 
                required
                value={newNoteText}
                onChange={e => setNewNoteText(e.target.value)}
                className="w-full h-48 p-4 rounded-2xl border border-sky-100 bg-sky-50 focus:ring-2 focus:ring-sky-500 outline-none transition-all resize-none overflow-y-auto"
                placeholder="Digite a evolução do paciente, observações ou links..."
              />
            </div>
          </ModalContent>
          <ModalFooter>
            <div className="flex gap-3">
              <Button variant="outline" type="button" onClick={() => setNewNoteModalOpen(false)} className="flex-1">Cancelar</Button>
              <Button type="submit" className="flex-1">Salvar Nota</Button>
            </div>
          </ModalFooter>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Excluir Cliente">
        <ModalContent>
          <div className="space-y-4">
            <div className="p-4 bg-red-50 rounded-2xl border border-red-100 text-red-600 text-sm">
              <p className="font-bold mb-2">Atenção!</p>
              <p>Tem certeza que deseja excluir <strong>{clientToDelete?.name}</strong>?</p>
              <p className="mt-2 text-xs opacity-80">Esta ação removerá o cliente e todos os seus agendamentos vinculados permanentemente.</p>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteModalOpen(false)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" onClick={confirmDelete}>Excluir</Button>
          </div>
        </ModalFooter>
      </Modal>

      {/* Success Message Toast-like */}
      <AnimatePresence>
        {deleteMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-sky-900 text-white rounded-full shadow-2xl font-bold text-sm flex items-center gap-2"
          >
            <Check size={18} className="text-green-400" />
            {deleteMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IaraView({ appointments, clients, handleSendProp, isTypingProp }: { appointments: Appointment[]; clients: Client[]; handleSendProp: (t: string) => Promise<void>; isTypingProp: boolean }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const path = getPath(user.uid, 'messages');
    const q = query(
      collection(db, path), 
      where('archived', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(), 
        timestamp: (d.data().timestamp as Timestamp).toDate() 
      } as Message));
      setMessages(msgs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return unsub;
  }, [user]);

  const archiveConversation = async () => {
    if (!user || messages.length === 0) return;
    if (!confirm("Deseja encerrar e salvar esta conversa no histórico?")) return;
    
    const path = getPath(user.uid, 'messages');
    try {
      const promises = messages.map(msg => 
        updateDoc(doc(db, path, msg.id), { archived: true })
      );
      await Promise.all(promises);
      speak("Conversa encerrada e salva no histórico.");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("Seu navegador não suporta reconhecimento de voz.");
      return;
    }

    if (isListening) return;

    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
      playSound('active');
    };
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        handleSendProp(transcript);
      }
    };
    recognition.onerror = () => setIsListening(false);

    recognition.start();
  };

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-sky-900 tracking-tight">I.A.R.A</h2>
          <p className="text-sky-600 font-medium">Sua assistente está pronta para ajudar.</p>
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <Button variant="outline" onClick={archiveConversation} className="text-xs py-1 px-3">
              <CheckCircle size={14} />
              Encerrar Conversa
            </Button>
          )}
          <div className="flex items-center gap-2 bg-sky-100 px-3 py-1 rounded-full text-sky-600 text-xs font-bold">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Online
          </div>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden p-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
              <div className="w-20 h-20 bg-sky-50 rounded-full flex items-center justify-center">
                <Sparkles className="text-sky-300 w-10 h-10" />
              </div>
              <div>
                <p className="text-sky-900 font-bold">Olá! Eu sou I.A.R.A.</p>
                <p className="text-sky-600 text-sm">Como posso ajudar na sua agenda hoje?</p>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={msg.id} 
              className={cn("flex", msg.sender === 'user' ? "justify-end" : "justify-start")}
            >
              <div className={cn(
                "max-w-[80%] p-4 rounded-2xl shadow-sm",
                msg.sender === 'user' 
                  ? "bg-sky-500 text-white rounded-tr-none" 
                  : "bg-sky-50 text-sky-900 rounded-tl-none border border-sky-100"
              )}>
                <div className="prose prose-sm prose-sky max-w-none">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                <div className={cn("text-[10px] mt-1 opacity-50", msg.sender === 'user' ? "text-right" : "text-left")}>
                  {format(msg.timestamp, 'HH:mm')}
                </div>
              </div>
            </motion.div>
          ))}
          {isTypingProp && (
            <div className="flex justify-start">
              <div className="bg-sky-50 p-4 rounded-2xl rounded-tl-none border border-sky-100 flex gap-1">
                <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 bg-sky-300 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-sky-50 bg-sky-50/30">
          <div className="flex gap-2">
            <button 
              onClick={toggleVoice}
              className={cn(
                "p-4 rounded-2xl transition-all shadow-md",
                isListening ? "bg-red-500 text-white animate-pulse" : "bg-white text-sky-500 hover:bg-sky-50"
              )}
            >
              {isListening ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <div className="flex-1 relative">
              <textarea 
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (input.trim()) {
                      handleSendProp(input).then(() => setInput(''));
                    }
                  }
                }}
                placeholder="Digite sua mensagem..."
                className="w-full h-14 p-4 pr-14 rounded-2xl border border-sky-100 bg-white focus:ring-2 focus:ring-sky-500 outline-none transition-all resize-none overflow-y-auto shadow-sm"
              />
              <button 
                onClick={() => { if (input.trim()) { handleSendProp(input).then(() => setInput('')); } }}
                disabled={!input.trim()}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-sky-500 hover:text-sky-600 disabled:opacity-30"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
