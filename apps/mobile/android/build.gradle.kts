allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Force every Android module (app + plugins) to compile against SDK 36. Some
// plugins pin an older compileSdk (e.g. file_picker on 34) while their transitive
// deps (flutter_plugin_android_lifecycle) require 36 — this resolves the mismatch.
fun Project.forceCompileSdk36() {
    val ext = extensions.findByName("android") ?: return
    runCatching {
        ext.javaClass.getMethod("compileSdkVersion", Int::class.javaPrimitiveType).invoke(ext, 36)
    }.recoverCatching {
        ext.javaClass.getMethod("setCompileSdk", Integer::class.java).invoke(ext, 36)
    }
}

subprojects {
    // Guard against the "afterEvaluate when already evaluated" error: :app is
    // evaluated early via evaluationDependsOn above.
    if (state.executed) forceCompileSdk36() else afterEvaluate { forceCompileSdk36() }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
