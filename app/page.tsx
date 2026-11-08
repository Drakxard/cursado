import styles from './home.module.css'
import { HomeChoices } from '@/components/home-choices'

export default function Home() {
  return <main className={styles.home}>
    <HomeChoices />
  </main>
}
