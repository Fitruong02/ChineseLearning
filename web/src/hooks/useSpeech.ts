import { useEffect, useRef, useState } from 'react'

const isChineseVoice = (voice: SpeechSynthesisVoice) =>
  voice.lang.startsWith('zh') || /chinese|mandarin/i.test(voice.name)

export type VoiceGenderMode = 'auto' | 'male' | 'female'
export interface ChineseVoiceOption {
  uri: string
  label: string
}

const isMaleVoice = (voice: SpeechSynthesisVoice) =>
  /male|man|nam|男|david|jian|yunjian|xiaoyi/i.test(voice.name)

const isFemaleVoice = (voice: SpeechSynthesisVoice) =>
  /female|woman|nu|nữ|女|xiaoxiao|xiaohan|huihui/i.test(voice.name)

const pickByLangPriority = (voices: SpeechSynthesisVoice[]) =>
  voices.find((item) => item.lang === 'zh-CN') ??
  voices.find((item) => item.lang === 'zh-TW') ??
  voices[0]

export const useSpeech = () => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceMode, setVoiceMode] = useState<VoiceGenderMode>(() => {
    const saved = window.localStorage.getItem('speech-voice-mode')
    if (saved === 'male' || saved === 'female' || saved === 'auto') {
      return saved
    }
    return 'auto'
  })
  const [selectedVoiceUri, setSelectedVoiceUri] = useState<string>(() => {
    return window.localStorage.getItem('speech-selected-voice-uri') ?? ''
  })
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const voiceModeRef = useRef<VoiceGenderMode>(voiceMode)
  const selectedVoiceUriRef = useRef<string>(selectedVoiceUri)

  useEffect(() => {
    voicesRef.current = voices
  }, [voices])

  useEffect(() => {
    voiceModeRef.current = voiceMode
    window.localStorage.setItem('speech-voice-mode', voiceMode)
  }, [voiceMode])

  useEffect(() => {
    selectedVoiceUriRef.current = selectedVoiceUri
    window.localStorage.setItem('speech-selected-voice-uri', selectedVoiceUri)
  }, [selectedVoiceUri])

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      return
    }

    const synth = window.speechSynthesis
    const refreshVoices = () => {
      const nextVoices = synth.getVoices().filter(isChineseVoice)
      setVoices(nextVoices)
    }

    refreshVoices()
    synth.addEventListener('voiceschanged', refreshVoices)

    return () => {
      synth.removeEventListener('voiceschanged', refreshVoices)
    }
  }, [])

  const voiceOptions = voices.map((voice) => ({
    uri: voice.voiceURI,
    label: `${voice.name} (${voice.lang})`,
  }))

  const speak = (text: string) => {
    if (!text || !('speechSynthesis' in window)) {
      return false
    }

    const preferredVoiceUri = selectedVoiceUriRef.current
    const explicitVoice = preferredVoiceUri
      ? voicesRef.current.find((voice) => voice.voiceURI === preferredVoiceUri)
      : undefined
    const mode = voiceModeRef.current
    let voice: SpeechSynthesisVoice | undefined
    if (explicitVoice) {
      voice = explicitVoice
    } else if (mode === 'male') {
      voice = pickByLangPriority(voicesRef.current.filter(isMaleVoice))
    } else if (mode === 'female') {
      voice = pickByLangPriority(voicesRef.current.filter(isFemaleVoice))
    } else {
      voice = pickByLangPriority(voicesRef.current)
    }
    if (!voice) {
      voice = pickByLangPriority(voicesRef.current)
    }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = voice?.lang ?? 'zh-CN'

    if (voice) {
      utterance.voice = voice
    }

    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)

    return Boolean(voice)
  }

  return {
    hasChineseVoice: voices.length > 0,
    voiceMode,
    setVoiceMode,
    selectedVoiceUri,
    setSelectedVoiceUri,
    voiceOptions,
    speak,
  }
}
