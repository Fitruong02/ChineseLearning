import { useEffect, useRef, useState } from 'react'

const isChineseVoice = (voice: SpeechSynthesisVoice) =>
  voice.lang.startsWith('zh') || /chinese|mandarin/i.test(voice.name)

export const useSpeech = () => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    voicesRef.current = voices
  }, [voices])

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

  const speak = (text: string) => {
    if (!text || !('speechSynthesis' in window)) {
      return false
    }

    const voice =
      voicesRef.current.find((item) => item.lang === 'zh-CN') ??
      voicesRef.current.find((item) => item.lang === 'zh-TW') ??
      voicesRef.current[0]

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
    speak,
  }
}
