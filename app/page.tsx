import styles from './home.module.css'
import { WorkspaceLibraryButton } from '@/components/workspace-library'
import { HomeChoices } from '@/components/home-choices'

export default function Home() {
  return <main className={styles.home}>
    <WorkspaceLibraryButton />
    <HomeChoices />
  </main>
}
