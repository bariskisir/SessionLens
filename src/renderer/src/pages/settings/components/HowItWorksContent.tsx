import { useTranslation } from 'react-i18next'
import styles from './HowItWorksModal.module.scss'

const icons = ['📍', '🔗', '📡', '⚡', '🗺️', '💻']
const stepKeys = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6']

const HowItWorksContent = (): React.JSX.Element => {
  const { t } = useTranslation()

  return (
    <div>
      <p className={styles.intro}>{t('about.howItWorksIntro')}</p>
      <div className={styles.flow}>
        {stepKeys.map((key, i) => (
          <div key={key} className={styles.step}>
            <div className={styles.badge}>
              <div className={styles.circle}>{icons[i]}</div>
              <div className={styles.connector} />
            </div>
            <div className={styles.body}>
              <p className={styles.stepTitle}>{t(`about.howItWorksSteps.${key}`)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default HowItWorksContent
