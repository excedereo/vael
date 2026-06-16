import { BookOpen } from 'lucide-react'
import { MemoryPage } from '../components/MemoryPage.js'
import { VaeliPanel } from '../types/panel.js'

export const memoryPanel: VaeliPanel = {
  id: 'memory',
  label: 'Memory',
  icon: <BookOpen size={16} />,
  render() {
    return <MemoryPage onBack={() => {}} />
  },
}
