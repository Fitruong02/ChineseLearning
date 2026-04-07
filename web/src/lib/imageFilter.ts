import type { PublishedCard } from '../types'

const ABSTRACT_VI_KEYWORDS = [
  'dần dần',
  'phổ biến',
  'quan hệ',
  'sự việc',
  'bao gồm',
  'cũng như',
  'vì vậy',
  'liên quan',
  'đảm bảo',
  'nhu cầu',
  'khẩn cấp',
  'quan niệm',
  'chức danh',
  'chức năng',
  'quy trình',
  'thành tựu',
  'hiệp định',
  'chi phí',
  'sinh tồn',
  'tồn tại',
  'văn minh',
  'thời trang',
  'văn hóa',
  'giao lưu',
  'chia sẻ',
  'thảo luận',
  'đăng tải',
]

const CONCRETE_VI_HINTS = [
  'bệnh viện',
  'phòng khám',
  'hộ chiếu',
  'máy',
  'thiết bị',
  'khăn giấy',
  'giấy vệ sinh',
  'máy quay',
  'vịt quay',
  'câu lạc bộ',
  'huấn luyện viên',
  'công tắc',
  'nguồn điện',
  'dòng điện',
  'trang web',
  'bài đăng',
  'đường ống',
  'nhân viên',
  'doanh nghiệp',
  'công ty',
  'thuốc',
  'đơn thuốc',
  'khu vực',
  'thành phố',
  'thị trấn',
]

const ABSTRACT_HANZI_HINTS = [
  '以及',
  '则',
  '至',
  '仅仅',
  '因此',
  '相关',
  '逐渐',
  '理念',
  '文明',
  '交流',
]

const CONCRETE_HANZI_HINTS = [
  '医院',
  '护照',
  '摄像机',
  '餐巾纸',
  '卫生纸',
  '热水器',
  '电源',
  '开关',
  '烤鸭',
  '俱乐部',
  '教练',
  '器械',
  '诊室',
  '药方',
  '病历',
]

const normalize = (text: string) => text.toLowerCase().trim()

const containsAny = (text: string, keywords: string[]) =>
  keywords.some((keyword) => text.includes(keyword))

export const isImageLikelyHelpful = (card: PublishedCard) => {
  if (!card.imageUrl) return false

  const meaning = normalize(card.meaningVi)
  const hanzi = card.hanzi

  if (hanzi.length <= 1) return false
  if (containsAny(hanzi, ABSTRACT_HANZI_HINTS)) return false
  if (containsAny(meaning, ABSTRACT_VI_KEYWORDS)) return false
  if (containsAny(hanzi, CONCRETE_HANZI_HINTS)) return true
  if (containsAny(meaning, CONCRETE_VI_HINTS)) return true

  const looksNounLike =
    meaning.includes('máy ') ||
    meaning.includes('người ') ||
    meaning.includes('hộ ') ||
    meaning.includes('phòng ') ||
    meaning.includes('bệnh ') ||
    meaning.includes('thiết bị')

  return looksNounLike
}

